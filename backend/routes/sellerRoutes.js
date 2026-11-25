const express = require('express')
const { body, param, query } = require('express-validator')
const authenticate = require('../middleware/authMiddleware')
const { asyncHandler } = require('../middleware/errorMiddleware')
const sellerController = require('../controllers/sellerController')
const { parseVerificationUpload } = require('../middleware/verificationUpload')

const router = express.Router()

// Public slug routes – no authentication required
router.get(
  '/public/slug/:slug',
  param('slug').matches(/^[a-z0-9][a-z0-9-]{1,47}$/i),
  asyncHandler(sellerController.publicProfileBySlug),
)
router.get(
  '/public/:slug',
  param('slug').matches(/^[a-z0-9-]{1,180}$/),
  asyncHandler(sellerController.publicProfile),
)

router.use(authenticate)

// Username availability check
router.get(
  '/username/check',
  query('username').trim().isLength({ min: 3, max: 48 }),
  asyncHandler(sellerController.checkUsername),
)

// Update username / public slug
router.put(
  '/username',
  body('username').trim().isLength({ min: 3, max: 48 }).withMessage('Username must be between 3 and 48 characters.'),
  asyncHandler(sellerController.updateUsername),
)

const verificationFields = [
  body('verificationType').isIn(['individual', 'registered_business', 'renewable_energy_company']),
  body('businessName').trim().isLength({ min: 2, max: 160 }),
  body('businessOwner').trim().isLength({ min: 2, max: 120 }),
  body('businessEmail').optional({ values: 'falsy' }).trim().isEmail().isLength({ max: 254 }),
  body('registrationNumber').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  body('businessAddress').trim().isLength({ min: 5, max: 255 }),
  body('businessPhone').trim().isLength({ min: 8, max: 32 }),
  body('whatsapp').optional({ values: 'falsy' }).trim().isLength({ min: 8, max: 32 }),
  body('state').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  body('city').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
  body('businessDescription').optional({ values: 'falsy' }).trim().isLength({ max: 5000 }),
  body('website').optional({ values: 'falsy' }).isURL({ protocols: ['http', 'https'], require_protocol: true }).isLength({ max: 2048 }),
  body('businessCategoryId').optional({ values: 'falsy' }).isInt({ min: 1 }),
]

router.get('/dashboard', asyncHandler(sellerController.dashboard))
router.get('/ads',
  query('status').optional({ values: 'falsy' }).isIn(['pending', 'approved', 'rejected', 'paused', 'suspended', 'changes_requested', 'sold', 'expired'])
    .withMessage('Choose a supported advertisement status.'),
  query('q').optional({ values: 'falsy' }).isLength({ max: 100 })
    .withMessage('Search must be 100 characters or less.'),
  query('sort').optional({ values: 'falsy' }).isIn(['newest', 'oldest', 'views', 'price_asc', 'price_desc'])
    .withMessage('Choose a supported sort order.'),
  query('page').optional({ values: 'falsy' }).isInt({ min: 1 })
    .withMessage('Page must be a positive integer.'),
  query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 50 })
    .withMessage('Page size must be between 1 and 50.'),
  asyncHandler(sellerController.advertisements),
)
const analyticsDateFields = [
  query('days').optional({ values: 'falsy' }).isIn(['7', '30', '90', '365']),
  query('from').optional({ values: 'falsy' }).isISO8601({ strict: true })
    .withMessage('Enter a valid start date.'),
  query('to').optional({ values: 'falsy' }).isISO8601({ strict: true })
    .withMessage('Enter a valid end date.'),
]
router.get('/analytics', ...analyticsDateFields, asyncHandler(sellerController.analytics))
router.get('/analytics/:advertisementId', param('advertisementId').isInt({ min: 1 }), ...analyticsDateFields, asyncHandler(sellerController.analytics))
router.post('/verification/upload-urls', asyncHandler(sellerController.createVerificationUploadUrls))
router.post('/verification', parseVerificationUpload, ...verificationFields, asyncHandler(sellerController.submitVerification))
router.put('/verification', parseVerificationUpload, ...verificationFields, asyncHandler(sellerController.updateVerification))
router.post('/verification/documents', parseVerificationUpload, asyncHandler(sellerController.uploadVerificationDocuments))
router.get('/verification', asyncHandler(sellerController.verification))
router.get('/notifications', asyncHandler(sellerController.notifications))
router.put('/notifications/:id/read', param('id').isInt({ min: 1 }), asyncHandler(sellerController.markNotificationRead))
router.patch(
  '/ads/:id/status',
  param('id').isInt({ min: 1 }),
  body('status').isIn(['paused', 'approved', 'sold']),
  asyncHandler(sellerController.setAdvertisementStatus),
)
router.post('/ads/:id/duplicate', param('id').isInt({ min: 1 }), asyncHandler(sellerController.duplicateAdvertisement))

module.exports = router
