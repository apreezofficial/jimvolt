const crypto = require('node:crypto')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const { validationResult } = require('express-validator')
const userModel = require('../models/userModel')
const emailService = require('../services/emailService')
const { isValidNigerianPhone, normalizeNigerianPhone } = require('../utils/phone')
const { normalizeUsername, suggestUsername, validateUsername } = require('../utils/slugUtils')
const sellerModel = require('../models/sellerModel')

function checkValidation(req) {
  const errors = validationResult(req)
  if (errors.isEmpty()) return
  const error = new Error(errors.array()[0].msg)
  error.statusCode = 400
  throw error
}

function sanitizeUser(user) {
  if (!user) return user
  const { password, password_reset_token, password_reset_expires_at, token_version, ...safeUser } = user
  return safeUser
}

function createToken(user) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters.')
  }
  return jwt.sign(
    { sub: String(user.id), role: user.role, tokenVersion: Number(user.token_version || 0) },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  )
}

async function verifyEmail(req, res) {
  checkValidation(req)
  const tokenHash = crypto.createHash('sha256').update(String(req.body.token).trim()).digest('hex')
  const pending = await userModel.findByEmailVerificationToken(tokenHash)
  if (!pending) {
    const error = new Error('This verification link is invalid or has expired.')
    error.statusCode = 400
    throw error
  }
  const user = await userModel.consumeEmailVerification(pending.id, pending.pending_email, tokenHash)
  if (!user) {
    const error = new Error('This verification link is invalid or has expired.')
    error.statusCode = 400
    throw error
  }
  return res.json({ message: 'Your email address has been verified.', user: sanitizeUser(user) })
}

async function register(req, res) {
  checkValidation(req)

  const fullName = req.body.fullName.trim()
  const email = req.body.email.trim().toLowerCase()
  const phone = normalizeNigerianPhone(req.body.phone)
  const password = req.body.password

  if (!isValidNigerianPhone(phone)) {
    const error = new Error('Enter a valid Nigerian phone number.')
    error.statusCode = 400
    throw error
  }

  if (password.length < 8) {
    const error = new Error('Password must be at least 8 characters long.')
    error.statusCode = 400
    throw error
  }

  const existingByEmail = await userModel.findByEmail(email)
  const existingByPhone = await userModel.findByPhone(phone)
  if (existingByEmail || existingByPhone) {
    const error = new Error('An account with this email or phone number already exists.')
    error.statusCode = 409
    throw error
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const username = await chooseUsername(req.body.username, fullName)

  try {
    const user = await userModel.create({ fullName, email, phone, passwordHash, username })
    // The account already exists, so a failed welcome email must not fail registration.
    emailService.sendWelcomeEmail(user.email, fullName).catch((error) => {
      console.error('[auth] Welcome email failed:', error.message)
    })
    return res.status(201).json({ user: sanitizeUser(user), token: createToken(user) })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      const conflict = new Error('An account with this email or phone number already exists.')
      conflict.statusCode = 409
      throw conflict
    }
    throw error
  }
}

/**
 * Picks the public username at signup. A username the user typed must be valid
 * and free. When they left it blank, one is suggested from their name and a
 * number is appended until a free one is found.
 */
async function chooseUsername(requested, fullName) {
  const typed = String(requested || '').trim()
  if (typed) {
    const normalized = normalizeUsername(typed)
    const problem = validateUsername(normalized)
    if (problem) {
      const error = new Error(problem)
      error.statusCode = 400
      throw error
    }
    if (await userModel.isUsernameTaken(normalized)) {
      const error = new Error('That username is already taken. Please choose a different one.')
      error.statusCode = 409
      throw error
    }
    return normalized
  }

  const base = suggestUsername(fullName)
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${crypto.randomInt(10, 99999)}`.slice(0, 48)
    if (!validateUsername(candidate) && !(await userModel.isUsernameTaken(candidate))) return candidate
  }
  return `member-${crypto.randomBytes(4).toString('hex')}`
}

async function checkUsername(req, res) {
  const normalized = normalizeUsername(String(req.query.username || '').trim())
  const reason = validateUsername(normalized)
  if (reason) return res.json({ available: false, username: normalized, reason })
  const taken = await userModel.isUsernameTaken(normalized, req.user?.id || null)
  return res.json({
    available: !taken,
    username: normalized,
    reason: taken ? 'That username is already taken.' : null,
  })
}

async function setUsername(req, res) {
  checkValidation(req)
  const normalized = normalizeUsername(String(req.body.username || '').trim())
  const problem = validateUsername(normalized)
  if (problem) {
    const error = new Error(problem)
    error.statusCode = 400
    throw error
  }

  // Sellers keep their public slug in sync with the username (old slugs are archived).
  const sellerResult = await sellerModel.updatePublicSlug(req.user.id, normalized)
  if (sellerResult === 'unavailable') {
    const error = new Error('That username is already taken. Please choose a different one.')
    error.statusCode = 409
    throw error
  }
  if (sellerResult === 'no_profile') {
    if (await userModel.isUsernameTaken(normalized, req.user.id)) {
      const error = new Error('That username is already taken. Please choose a different one.')
      error.statusCode = 409
      throw error
    }
    try {
      await userModel.setUsername(req.user.id, normalized)
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        const conflict = new Error('That username is already taken. Please choose a different one.')
        conflict.statusCode = 409
        throw conflict
      }
      throw error
    }
  }

  const user = await userModel.findById(req.user.id)
  return res.json({ message: 'Username updated.', username: normalized, user: sanitizeUser(user) })
}

/**
 * Finds the member for a login identifier: an email, a Nigerian phone number,
 * or a username. Phone numbers are tried first, then usernames.
 */
async function findLoginUser(rawIdentifier) {
  const identifier = rawIdentifier.trim()
  if (!identifier) return null
  if (identifier.includes('@')) return userModel.findByEmail(identifier.toLowerCase())

  const phone = normalizeNigerianPhone(identifier)
  if (isValidNigerianPhone(phone)) {
    const byPhone = await userModel.findByPhone(phone)
    if (byPhone) return byPhone
  }
  return userModel.findByUsername(normalizeUsername(identifier))
}

async function login(req, res) {
  checkValidation(req)

  const user = await findLoginUser(String(req.body.identifier || ''))

  const passwordMatches = user && await bcrypt.compare(req.body.password, user.password)
  if (!passwordMatches || user.account_status !== 'active') {
    const error = new Error('Email or password is incorrect.')
    error.statusCode = 401
    throw error
  }

  await userModel.updateLastLogin(user.id)
  const safeUser = sanitizeUser(user)
  return res.json({ user: safeUser, token: createToken(user) })
}

async function adminLogin(req, res) {
  checkValidation(req)

  const email = String(req.body.email || '').trim().toLowerCase()
  const user = await userModel.findByEmail(email)
  const passwordMatches = user && await bcrypt.compare(req.body.password, user.password)

  if (!passwordMatches || user.account_status !== 'active') {
    const error = new Error('Email or password is incorrect.')
    error.statusCode = 401
    throw error
  }

  if (!['admin', 'super_admin'].includes(user.role)) {
    const error = new Error('This account is not authorized to access administrator tools.')
    error.statusCode = 403
    throw error
  }

  await userModel.updateLastLogin(user.id)
  const safeUser = sanitizeUser(user)
  return res.json({ user: safeUser, token: createToken(user) })
}

async function forgotPassword(req, res) {
  checkValidation(req)
  const email = String(req.body.email || '').trim().toLowerCase()
  const user = await userModel.findByEmail(email)

  if (user) {
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    await userModel.setPasswordResetToken(user.id, tokenHash, expiresAt)

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${encodeURIComponent(token)}`
    // Always answer the same way so the response does not reveal which emails have accounts.
    try {
      await emailService.sendPasswordResetEmail(user.email, resetUrl)
    } catch (error) {
      console.error('[auth] Password reset email failed:', error.message)
    }
  }

  return res.json({ message: 'If an account exists for that email, a password reset link has been sent.' })
}

async function resetPassword(req, res) {
  checkValidation(req)
  const { token, password } = req.body
  if (!token || !String(token).trim()) {
    const error = new Error('Reset token is required.')
    error.statusCode = 400
    throw error
  }

  const tokenHash = crypto.createHash('sha256').update(String(token).trim()).digest('hex')
  const user = await userModel.findByResetToken(tokenHash)
  if (!user) {
    const error = new Error('This reset token is invalid or has expired.')
    error.statusCode = 400
    throw error
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const consumed = await userModel.consumePasswordReset(user.id, passwordHash, tokenHash)
  if (!consumed) {
    const error = new Error('This reset token is invalid or has expired.')
    error.statusCode = 400
    throw error
  }
  return res.json({ message: 'Your password has been reset successfully.' })
}

function me(req, res) {
  return res.json({ user: sanitizeUser(req.user) })
}

async function logout(req, res) {
  await userModel.invalidateTokens(req.user.id)
  req.app.get('io')?.in(`user:${req.user.id}`).disconnectSockets(true)
  return res.json({ message: 'You have been logged out.' })
}

module.exports = { adminLogin, checkUsername, createToken, forgotPassword, login, logout, me, register, resetPassword, setUsername, verifyEmail }
