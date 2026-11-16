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

/**
 * Finds or creates the member for a verified Google profile and returns them.
 * Google sign-in only ever produces ordinary members. An existing admin or
 * super admin is never linked by email, so Google cannot grant or reach admin access.
 * Throws an Error whose `code` is the reason shown on the login page.
 */
async function signInWithGoogleProfile(profile) {
  if (!profile.sub || !profile.email || !profile.emailVerified) {
    const error = new Error('Google did not return a verified email address.')
    error.code = 'google_unverified_email'
    throw error
  }

  let user = await userModel.findByGoogleSub(profile.sub)
  if (!user) {
    const existing = await userModel.findByEmail(profile.email)
    if (existing) {
      if (existing.role !== 'user') {
        const error = new Error('This account cannot be used with Google sign-in.')
        error.code = 'google_account_not_eligible'
        throw error
      }
      await userModel.linkGoogleSub(existing.id, profile.sub)
      user = existing
    } else {
      user = await createGoogleMember(profile)
    }
  }

  if (!user || user.account_status !== 'active') {
    const error = new Error('This account is suspended.')
    error.code = 'account_suspended'
    throw error
  }

  await userModel.updateLastLogin(user.id)
  return userModel.findById(user.id)
}

async function createGoogleMember(profile) {
  const fullName = (profile.name || profile.email.split('@')[0]).slice(0, 120)
  // Google members sign in with Google only. A random hash keeps the column filled.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12)
  let username = suggestUsername(fullName)
  if (validateUsername(normalizeUsername(username)) || await userModel.isUsernameTaken(username)) {
    username = `${username.slice(0, 40)}-${crypto.randomInt(10, 99999)}`
  }
  // No role is passed, so the database default ('user') applies.
  const created = await userModel.create({ fullName, email: profile.email, phone: null, passwordHash, username })
  await userModel.linkGoogleSub(created.id, profile.sub)
  return created
}

// Redirect flow: /api/auth/google -> Google -> /api/auth/google/callback.
function googleStart(req, res) {
  if (!googleOAuth.isGoogleConfigured()) return failTo(res, 'google_not_configured')
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

  try {
    const user = await signInWithGoogleProfile(profile)
    // The token travels in the URL fragment, which the browser never sends to a server.
    return res.redirect(`${frontendUrl()}/auth/google/complete#token=${encodeURIComponent(createToken(user))}`)
  } catch (error) {
    return failTo(res, error.code || 'google_failed')
  }
}

// Popup flow: the browser gets a Google ID token from the Google button and posts it here.
async function googleCredential(req, res) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    const error = new Error('Google sign-in is not set up yet.')
    error.statusCode = 503
    throw error
  }

  let profile
  try {
    profile = await googleOAuth.verifyIdToken(String(req.body.credential || ''))
  } catch (error) {
    const invalid = new Error('Google sign-in could not be verified. Please try again.')
    invalid.statusCode = 401
    throw invalid
  }

  try {
    const user = await signInWithGoogleProfile(profile)
    return res.json({ user: sanitize(user), token: createToken(user) })
  } catch (error) {
    const response = new Error(error.message)
    response.statusCode = error.code === 'account_suspended' || error.code === 'google_account_not_eligible' ? 403 : 400
    throw response
  }
}

function sanitize(user) {
  const { password, password_reset_token, password_reset_expires_at, token_version, ...safe } = user
  return safe
}

module.exports = { googleCallback, googleCredential, googleStart }
