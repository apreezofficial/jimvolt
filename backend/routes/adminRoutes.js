const express = require('express')
const { rateLimit } = require('../utils/rateLimit')
const { body, param, query } = require('express-validator')
const adminController = require('../controllers/adminController')
const promotionController = require('../controllers/promotionController')
const authController = require('../controllers/authController')
const bannerController = require('../controllers/bannerController')
const bannerImageUpload = require('../middleware/bannerImageUpload')
const requireAdmin = require('../middleware/adminMiddleware')
const requireSuperAdmin = require('../middleware/superAdminMiddleware')
const authenticate = require('../middleware/authMiddleware')
const { asyncHandler } = require('../middleware/errorMiddleware')

const router = express.Router()
const adminLoginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many administrator sign-in attempts. Please try again later.' },
})
const statuses = ['pending', 'approved', 'rejected', 'paused', 'suspended', 'changes_requested', 'sold', 'expired']
const reportStatuses = ['open', 'investigating', 'resolved', 'dismissed']
const verificationStatuses = ['pending', 'verified', 'rejected', 'information_requested', 'revoked']
const pagination = [
  query('page').optional().isInt({ min: 1, max: 1000000 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('q').optional().trim().isLength({ max: 120 }),
]
const idParam = param('id').isInt({ min: 1 })
const moderationReason = body('reason').trim().isLength({ min: 3, max: 1000 })

router.post(
  '/login',
  adminLoginRateLimit,
  body('email').trim().isEmail().withMessage('Enter a valid email address.').isLength({ max: 254 }),
  body('password').isString().isLength({ min: 1, max: 72 }).withMessage('Enter your password.'),
  asyncHandler(authController.adminLogin),
)

router.use(authenticate, requireAdmin)

router.get('/dashboard', asyncHandler(adminController.dashboard))
router.get('/analytics', asyncHandler(adminController.analytics))

router.get('/ads', ...pagination, query('status').optional().isIn(statuses), query('sort').optional().isIn(['newest', 'oldest', 'price_asc', 'price_desc', 'views']), asyncHandler(adminController.advertisements))
router.get('/ads/:id', idParam, asyncHandler(adminController.viewAdvertisement))
router.put('/ads/:id/approve', idParam, asyncHandler(adminController.approveAdvertisement))
router.put('/ads/:id/reject', idParam, moderationReason, asyncHandler(adminController.rejectAdvertisement))
router.put('/ads/:id/request-changes', idParam, moderationReason, asyncHandler(adminController.requestAdvertisementChanges))
router.put('/ads/:id/suspend', idParam, moderationReason, asyncHandler(adminController.suspendAdvertisement))
router.put('/ads/:id/activate', idParam, asyncHandler(adminController.reactivateAdvertisement))
router.put('/ads/:id/feature', idParam, body('featured').isBoolean(), asyncHandler(adminController.featureAdvertisement))
router.put(
  '/ads/:id',
  idParam,
  body('title').optional().trim().isLength({ min: 3, max: 180 }),
  body('description').optional().trim().isLength({ min: 10, max: 10000 }),
  body('price').optional().isFloat({ min: 0, max: 99999999999.99 }),
  body('categoryId').optional().isInt({ min: 1 }),
  body('state').optional().trim().isLength({ min: 2, max: 100 }),
  body('city').optional().trim().isLength({ min: 1, max: 120 }),
  asyncHandler(adminController.updateAdvertisement),
)
router.delete('/ads/:id', idParam, asyncHandler(adminController.deleteAdvertisement))

router.get(
  '/users',
  ...pagination,
  query('role').optional().isIn(['user', 'admin', 'super_admin']),
  query('status').optional().isIn(['active', 'suspended']),
  query('verified').optional().isIn(['true', 'false']),
  query('verificationStatus').optional().isIn(['pending', 'verified', 'rejected', 'information_requested', 'revoked', 'none']),
  query('sort').optional().isIn(['newest', 'oldest']),
  asyncHandler(adminController.users),
)
router.get('/users/:id', idParam, asyncHandler(adminController.userDetail))
router.put('/users/:id/suspend', idParam, asyncHandler(adminController.suspendUser))
router.put('/users/:id/activate', idParam, asyncHandler(adminController.activateUser))
router.put('/users/:id/role', requireSuperAdmin, idParam, body('role').isIn(['user', 'admin', 'super_admin']), asyncHandler(adminController.updateUserRole))
router.get('/settings/administrators', requireSuperAdmin, asyncHandler(adminController.administrators))

router.get('/sellers', ...pagination, asyncHandler(adminController.sellers))
router.get('/verifications', ...pagination, query('status').optional().isIn(verificationStatuses), asyncHandler(adminController.verifications))
router.get('/verifications/pending', asyncHandler(adminController.listPendingVerifications))
router.get('/verifications/:id', idParam, asyncHandler(adminController.verificationDetail))
router.get('/verifications/:id/document/:document', idParam, param('document').isIn(['cac', 'identity', 'additional']), asyncHandler(adminController.getVerificationDocument))
router.get('/verifications/:id/document', idParam, asyncHandler(adminController.getVerificationDocument))
router.put('/verifications/:id/approve', idParam, asyncHandler(adminController.approveVerification))
router.put('/verifications/:id/reject', idParam, moderationReason, asyncHandler(adminController.rejectVerification))
router.put('/verifications/:id/request-information', idParam, body('reason').trim().isLength({ min: 3, max: 1000 }), asyncHandler((req, res) => {
  req.body.notes = req.body.reason
  return adminController.requestVerificationInfo(req, res)
}))
router.post('/verifications/:id/revoke', requireSuperAdmin, idParam, body('reason').trim().isLength({ min: 3, max: 1000 }), asyncHandler(adminController.revokeVerification))
router.put('/verifications/:id/request-info', idParam, body('notes').trim().isLength({ min: 3, max: 1000 }), asyncHandler(adminController.requestVerificationInfo))
router.patch(
  '/verifications/:id/status',
  idParam,
  body('status').isIn(['verified', 'rejected']),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
  asyncHandler(adminController.moderateVerification),
)

router.get('/categories', asyncHandler(adminController.listCategories))
router.post(
  '/categories',
  body('name').trim().isLength({ min: 2, max: 120 }),
  body('slug').optional({ values: 'falsy' }).matches(/^[a-z0-9-]{1,140}$/),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  body('image').optional({ values: 'falsy' }).isURL({ protocols: ['http', 'https'], require_protocol: true }).isLength({ max: 2048 }),
  body('isActive').optional().isBoolean(),
  body('displayOrder').optional().isInt({ min: 0, max: 100000 }),
  body('parentId').optional({ values: 'falsy' }).isInt({ min: 1 }),
  asyncHandler(adminController.saveCategory),
)
router.put(
  '/categories/:id',
  idParam,
  body('name').trim().isLength({ min: 2, max: 120 }),
  body('slug').optional({ values: 'falsy' }).matches(/^[a-z0-9-]{1,140}$/),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  body('image').optional({ values: 'falsy' }).isURL({ protocols: ['http', 'https'], require_protocol: true }).isLength({ max: 2048 }),
  body('isActive').optional().isBoolean(),
  body('displayOrder').optional().isInt({ min: 0, max: 100000 }),
  body('parentId').optional({ values: 'falsy' }).isInt({ min: 1 }),
  asyncHandler(adminController.saveCategory),
)
router.delete('/categories/:id', idParam, asyncHandler(adminController.deleteCategory))

router.get('/reports', ...pagination, query('status').optional().isIn(reportStatuses), query('category').optional().isIn(['fraud', 'fake_seller', 'misleading_description', 'incorrect_price', 'duplicate', 'suspicious_activity', 'inappropriate_content', 'message_abuse', 'other']), asyncHandler(adminController.reports))
router.put('/reports/:id/resolve', idParam, body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }), asyncHandler(adminController.resolveReportAction))
router.put('/reports/:id/dismiss', idParam, body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }), asyncHandler(adminController.dismissReport))
router.put('/reports/:id/investigate', idParam, body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }), asyncHandler(adminController.investigateReport))
router.post('/reports/:id/investigate-conversation', idParam, body('reason').trim().isLength({ min: 10, max: 1000 }), asyncHandler(adminController.investigateReportedConversation))

router.get('/payments', ...pagination, query('status').optional().isIn(['pending', 'succeeded', 'failed']), asyncHandler(adminController.payments))
router.get('/monetization', query('from').optional().isISO8601({ strict: true }), query('to').optional().isISO8601({ strict: true }), asyncHandler(promotionController.monetization))
router.get('/promotion-packages', asyncHandler(promotionController.adminPackages))
router.post(
  '/promotion-packages',
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
  body('price').isFloat({ min: 1, max: 99999999999.99 }),
  body('durationDays').isInt({ min: 1, max: 365 }),
  body('benefits').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  body('isActive').optional().isBoolean(),
  asyncHandler(promotionController.savePackage),
)
router.put(
  '/promotion-packages/:id',
  idParam,
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
  body('price').isFloat({ min: 1, max: 99999999999.99 }),
  body('durationDays').isInt({ min: 1, max: 365 }),
  body('benefits').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
  body('isActive').isBoolean(),
  asyncHandler(promotionController.savePackage),
)
router.get('/promotions', ...pagination, query('status').optional().isIn(['pending_payment', 'pending_approval', 'active', 'expired', 'paused', 'terminated', 'failed']), asyncHandler(promotionController.adminPromotions))
router.patch('/promotions/:id/status', idParam, body('status').isIn(['paused', 'terminated']), asyncHandler(promotionController.moderatePromotion))
router.get('/banners', asyncHandler(bannerController.adminList))
router.get('/banners/:id/image', idParam, asyncHandler(bannerController.adminImage))
router.post('/banners', bannerImageUpload, asyncHandler(bannerController.create))
router.put('/banners/:id', idParam, bannerImageUpload, asyncHandler(bannerController.update))
router.delete('/banners/:id', idParam, asyncHandler(bannerController.remove))
router.get('/audit-logs', ...pagination, asyncHandler(adminController.auditLogs))

router.get('/advertisements/pending', asyncHandler(adminController.listPending))
router.patch(
  '/advertisements/:id/status',
  idParam,
  body('status').isIn(['approved', 'rejected']).withMessage('Status must be approved or rejected.'),
  body('reason').if(body('status').equals('rejected')).trim().isLength({ min: 3, max: 1000 }),
  asyncHandler(adminController.moderate),
)

module.exports = router
