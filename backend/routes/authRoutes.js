const express = require('express')
const { rateLimit } = require('../utils/rateLimit')
const { body, query } = require('express-validator')
const authController = require('../controllers/authController')
const authenticate = require('../middleware/authMiddleware')
const { asyncHandler } = require('../middleware/errorMiddleware')

const router = express.Router()
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many authentication attempts. Please try again later.' },
})

router.post(
  '/register',
  authRateLimit,
  body('fullName').trim().isLength({ min: 2, max: 120 }).withMessage('Full name must be between 2 and 120 characters.'),
  body('email').trim().isEmail().withMessage('Enter a valid email address.').isLength({ max: 254 }),
  body('phone').trim().notEmpty().isLength({ min: 8, max: 32 }).withMessage('Enter a valid Nigerian phone number.'),
  body('username').optional({ values: 'falsy' }).isString().isLength({ max: 120 }).withMessage('Username is too long.'),
  body('password').isString().isLength({ min: 8, max: 72 }).withMessage('Password must be between 8 and 72 characters.'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error('Passwords do not match.')
    }
    return true
  }),
  asyncHandler(authController.register),
)

const usernameLookupLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many username checks. Please slow down.' },
})

router.get(
  '/username/check',
  usernameLookupLimit,
  query('username').isString().isLength({ max: 120 }),
  asyncHandler(authController.checkUsername),
)

router.put(
  '/username',
  authenticate,
  body('username').isString().isLength({ min: 3, max: 48 }).withMessage('Username must be between 3 and 48 characters.'),
  asyncHandler(authController.setUsername),
)

router.post(
  '/login',
  authRateLimit,
  body('identifier').trim().isLength({ min: 3, max: 120 }).withMessage('Enter your email, phone number or username.'),
  body('password').isString().isLength({ min: 1, max: 72 }).withMessage('Password must be between 1 and 72 characters.'),
  asyncHandler(authController.login),
)

router.post(
  '/forgot-password',
  authRateLimit,
  body('email').trim().isEmail().withMessage('Enter a valid email address.'),
  asyncHandler(authController.forgotPassword),
)

router.post(
  '/reset-password',
  authRateLimit,
  body('token').trim().notEmpty().withMessage('Reset token is required.'),
  body('password').isString().isLength({ min: 8, max: 72 }).withMessage('Password must be between 8 and 72 characters.'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error('Passwords do not match.')
    }
    return true
  }),
  asyncHandler(authController.resetPassword),
)

router.post(
  '/verify-email',
  authRateLimit,
  body('token').trim().notEmpty().withMessage('Email verification token is required.'),
  asyncHandler(authController.verifyEmail),
)

router.get('/me', authenticate, asyncHandler(authController.me))
router.post('/logout', authenticate, asyncHandler(authController.logout))

const googleAuthController = require('../controllers/googleAuthController')

router.get('/google', googleAuthController.googleStart)
router.get('/google/callback', asyncHandler(googleAuthController.googleCallback))

module.exports = router
