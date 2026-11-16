const crypto = require('node:crypto')
const bcrypt = require('bcrypt')
const userModel = require('../models/userModel')
const googleOAuth = require('../services/googleOAuthService')
const { createToken } = require('./authController')
const { suggestUsername, validateUsername, normalizeUsername } = require('../utils/slugUtils')

const STATE_COOKIE = 'jv_google_state'

function frontendUrl() {
  return (process.env.FRONTEND_URL || process.env.PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/$/, '')
}

function readCookie(req, name) {
  const header = req.headers.cookie || ''
  const match = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

function failTo(res, reason) {
  return res.redirect(`${frontendUrl()}/login?oauth_error=${encodeURIComponent(reason)}`)
}

function googleStart(req, res) {
  if (!googleOAuth.isGoogleConfigured()) {
    return failTo(res, 'google_not_configured')
  }
  const state = crypto.randomBytes(24).toString('base64url')
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=${state}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}`)
  return res.redirect(googleOAuth.buildAuthorizationUrl(state))
}

async function googleCallback(req, res) {
  // The state cookie is single-use: clear it whatever happens next.
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0`)

  if (req.query.error) return failTo(res, 'google_cancelled')
  const expected = readCookie(req, STATE_COOKIE)
  if (!expected || expected !== String(req.query.state || '')) return failTo(res, 'google_state')
  if (!req.query.code) return failTo(res, 'google_failed')

  let profile
  try {
    profile = await googleOAuth.fetchProfileFromCode(String(req.query.code))
  } catch (error) {
    console.error('[auth] Google sign-in failed:', error.message)
    return failTo(res, 'google_failed')
  }
  if (!profile.sub || !profile.email || !profile.emailVerified) return failTo(res, 'google_unverified_email')

  let user = await userModel.findByGoogleSub(profile.sub)
  if (!user) {
    user = await userModel.findByEmail(profile.email)
    if (user) {
      await userModel.linkGoogleSub(user.id, profile.sub)
    } else {
      user = await createGoogleMember(profile)
    }
  }
  if (!user || user.account_status !== 'active') return failTo(res, 'account_suspended')

  await userModel.updateLastLogin(user.id)
  const token = createToken(user)
  // The token travels in the URL fragment, which the browser never sends to a server.
  return res.redirect(`${frontendUrl()}/auth/google/complete#token=${encodeURIComponent(token)}`)
}

async function createGoogleMember(profile) {
  const fullName = (profile.name || profile.email.split('@')[0]).slice(0, 120)
  // Google members never sign in with a password. A random hash keeps the column filled.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12)
  let username = suggestUsername(fullName)
  if (validateUsername(normalizeUsername(username)) || await userModel.isUsernameTaken(username)) {
    username = `${username.slice(0, 40)}-${crypto.randomInt(10, 99999)}`
  }
  const created = await userModel.create({ fullName, email: profile.email, phone: null, passwordHash, username })
  await userModel.linkGoogleSub(created.id, profile.sub)
  return userModel.findById(created.id)
}

module.exports = { googleCallback, googleStart }
