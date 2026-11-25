const express = require('express')
const { param } = require('express-validator')
const { rateLimit } = require('../utils/rateLimit')
const bannerController = require('../controllers/bannerController')
const bannerOrderController = require('../controllers/bannerOrderController')
const authenticate = require('../middleware/authMiddleware')
const bannerImageUpload = require('../middleware/bannerImageUpload')
const { asyncHandler } = require('../middleware/errorMiddleware')

const router = express.Router()

const orderLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many banner orders. Please try again later.' },
})

router.get('/', asyncHandler(bannerController.listPublic))
router.get('/pricing', asyncHandler(bannerOrderController.pricing))
router.get('/mine', authenticate, asyncHandler(bannerOrderController.listMine))
router.post('/orders', authenticate, orderLimit, bannerImageUpload, asyncHandler(bannerOrderController.createOrder))
router.get('/orders/:reference/verify', authenticate, param('reference').isUUID(), asyncHandler(bannerOrderController.verifyOrder))
router.get('/:id/image', param('id').isInt({ min: 1 }), asyncHandler(bannerController.image))

module.exports = router
