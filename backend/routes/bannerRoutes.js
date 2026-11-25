const express = require('express')
const { param } = require('express-validator')
const bannerController = require('../controllers/bannerController')
const { asyncHandler } = require('../middleware/errorMiddleware')

const router = express.Router()

router.get('/', asyncHandler(bannerController.listPublic))
router.get('/:id/image', param('id').isInt({ min: 1 }), asyncHandler(bannerController.image))

module.exports = router
