const bcrypt = require('bcrypt')
const crypto = require('node:crypto')
const { validationResult } = require('express-validator')
const userModel = require('../models/userModel')
const adModel = require('../models/adModel')
const emailService = require('../services/emailService')
const { isValidNigerianPhone, normalizeNigerianPhone } = require('../utils/phone')
const { removeProfileImage, storeProfileImage } = require('../utils/profileImageStorage')

function checkValidation(req) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    const error = new Error(errors.array()[0].msg)
    error.statusCode = 400
    throw error
  }
}

function sanitizeUser(user) {
  if (!user) return user
  const { password, password_reset_token, password_reset_expires_at, token_version, ...safeUser } = user
  return safeUser
}

function getProfile(req, res) {
  return res.json({ user: sanitizeUser(req.user) })
}

async function getVerifiedSellers(req, res) {
  res.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600')
  return res.json({ sellers: await userModel.findVerifiedSellers() })
}

async function updateProfile(req, res) {
  checkValidation(req)
  const phone = req.body.phone?.trim()
  if (phone && !isValidNigerianPhone(phone)) {
    const error = new Error('Enter a valid Nigerian phone number.')
    error.statusCode = 400
    throw error
  }
  const normalizedPhone = normalizeNigerianPhone(phone)
  if (normalizedPhone && normalizedPhone !== req.user.phone) {
    const existing = await userModel.findByPhone(normalizedPhone)
    if (existing && String(existing.id) !== String(req.user.id)) {
      const error = new Error('That phone number is already in use.')
      error.statusCode = 409
      throw error
    }
  }

  const storedImage = req.file ? await storeProfileImage(req.file, req.user.id) : null
  let user
  try {
    user = await userModel.updateProfile(req.user.id, {
      fullName: req.body.fullName.trim(),
      phone: normalizedPhone,
      profileImage: storedImage?.url || req.user.profile_image,
    })
  } catch (error) {
    if (storedImage) {
      try {
        await removeProfileImage(storedImage.url, req.user.id)
      } catch (cleanupError) {
        console.error('Could not clean up a profile image after a failed profile update:', cleanupError.message)
      }
    }
    throw error
  }

  if (storedImage && req.user.profile_image && req.user.profile_image !== storedImage.url) {
    try {
      await removeProfileImage(req.user.profile_image, req.user.id)
    } catch (error) {
      console.error('Could not remove the previous profile image:', error.message)
    }
  }
  return res.json({ user: sanitizeUser(user) })
}

async function removeProfileImageFromAccount(req, res) {
  const previousImage = req.user.profile_image
  const user = await userModel.updateProfileImage(req.user.id, null)
  if (previousImage) {
    try {
      await removeProfileImage(previousImage, req.user.id)
    } catch (error) {
      console.error('Could not remove the previous profile image:', error.message)
    }
  }
  return res.json({ user: sanitizeUser(user) })
}

async function updateSettings(req, res) {
  checkValidation(req)

  const nextEmail = req.body.email?.trim().toLowerCase()
  const nextPhone = normalizeNigerianPhone(req.body.phone?.trim())

  if (req.body.phone && !isValidNigerianPhone(req.body.phone)) {
    const error = new Error('Enter a valid Nigerian phone number.')
    error.statusCode = 400
    throw error
  }

  if (nextEmail && nextEmail !== req.user.email) {
    const existing = await userModel.findByEmail(nextEmail)
    if (existing && existing.id !== req.user.id) {
      const error = new Error('That email address is already in use.')
      error.statusCode = 409
      throw error
    }

    const currentPassword = req.body.currentPassword
    const currentUser = await userModel.findByEmail(req.user.email)
    if (!currentPassword || !currentUser || !(await bcrypt.compare(currentPassword, currentUser.password))) {
      const error = new Error('Enter your current password to change your email address.')
      error.statusCode = 400
      throw error
    }
  }

  if (nextPhone && nextPhone !== req.user.phone) {
    const existingPhone = await userModel.findByPhone(nextPhone)
    if (existingPhone && existingPhone.id !== req.user.id) {
      const error = new Error('That phone number is already in use.')
      error.statusCode = 409
      throw error
    }
  }

  let emailVerificationRequired = false
  if (nextEmail && nextEmail !== req.user.email) {
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await userModel.setPendingEmail(req.user.id, nextEmail, tokenHash, expiresAt)
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify-email?token=${encodeURIComponent(token)}`
    await emailService.sendEmailVerification(nextEmail, verificationUrl)
    emailVerificationRequired = true
  }

  const user = await userModel.updateProfile(req.user.id, {
    fullName: req.body.fullName || req.user.full_name,
    phone: nextPhone || req.user.phone,
    profileImage: req.user.profile_image,
  })

  const refreshedUser = await userModel.findById(req.user.id)
  return res.json({
    user: sanitizeUser(refreshedUser),
    emailVerificationRequired,
    message: emailVerificationRequired
      ? 'Check your new email address for a verification link. Your email will change after confirmation.'
      : 'Profile details updated.',
  })
}

async function myAds(req, res) {
  const advertisements = await adModel.findByUser(req.user.id)
  return res.json({ advertisements })
}

async function getDashboard(req, res) {
  const stats = await userModel.getDashboardStats(req.user.id)
  const advertisements = await adModel.findByUser(req.user.id)
  return res.json({ stats, advertisements })
}

async function getFavorites(req, res) {
  const ids = await userModel.getFavorites(req.user.id)
  const advertisements = await adModel.findPublicByIds(ids)
  return res.json({ advertisements })
}

async function addFavorite(req, res) {
  checkValidation(req)
  const saved = await userModel.addFavorite(req.user.id, req.params.id)
  if (!saved) {
    const error = new Error('Advertisement not found.')
    error.statusCode = 404
    throw error
  }
  return res.status(204).end()
}

async function removeFavorite(req, res) {
  checkValidation(req)
  await userModel.removeFavorite(req.user.id, req.params.id)
  return res.status(204).end()
}

async function changePassword(req, res) {
  checkValidation(req)
  const currentPassword = req.body.currentPassword
  const newPassword = req.body.newPassword

  const user = await userModel.findByEmail(req.user.email)
  const passwordMatches = user && await bcrypt.compare(currentPassword, user.password)
  if (!passwordMatches) {
    const error = new Error('Current password is incorrect.')
    error.statusCode = 400
    throw error
  }

  const passwordHash = await bcrypt.hash(newPassword, 12)
  await userModel.updatePassword(req.user.id, passwordHash)
  return res.json({ message: 'Password updated successfully.' })
}

module.exports = {
  addFavorite,
  changePassword,
  getDashboard,
  getFavorites,
  getProfile,
  getVerifiedSellers,
  myAds,
  removeProfileImageFromAccount,
  removeFavorite,
  updateProfile,
  updateSettings,
}
