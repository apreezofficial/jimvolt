const { randomUUID } = require('node:crypto')
const { validationResult } = require('express-validator')
const promotionModel = require('../models/promotionModel')
const bachsService = require('../services/bachsService')

function checkValidation(req) {
  const errors = validationResult(req)
  if (errors.isEmpty()) return
  const error = new Error(errors.array()[0].msg)
  error.statusCode = 400
  throw error
}

function pageArgs(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20))
  return { page, limit }
}

function callbackUrl(reference, cancelled = false) {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim()
  const url = new URL('/dashboard/promotions', frontendUrl)
  url.searchParams.set('payment_reference', reference)
  if (cancelled) url.searchParams.set('checkout_cancelled', '1')
  return url.toString()
}

async function packages(req, res) {
  return res.json({ packages: await promotionModel.listPackages({ activeOnly: true }) })
}

async function featured(req, res) {
  res.set('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300')
  return res.json({ advertisements: await promotionModel.findFeaturedAdvertisements() })
}

async function track(req, res) {
  checkValidation(req)
  const tracked = await promotionModel.trackAdvertisement(req.params.id, req.body.event)
  return res.status(tracked ? 202 : 404).json({ tracked })
}

async function myPromotions(req, res) {
  return res.json({ promotions: await promotionModel.listForUser(req.user.id) })
}

async function initialize(req, res) {
  checkValidation(req)
  if (!process.env.BACHS_API_KEY) {
    const error = new Error('Promotion checkout is temporarily unavailable. Please try again later.')
    error.statusCode = 503
    throw error
  }
  const reference = randomUUID()
  const pending = await promotionModel.createPendingPromotion({
    userId: req.user.id,
    advertisementId: Number(req.body.advertisementId),
    packageId: Number(req.body.packageId),
    reference,
  })

  let checkout
  try {
    checkout = await bachsService.createPromotionCheckout({
      reference,
      amount: pending.package.price,
      promotionId: pending.id,
      successUrl: callbackUrl(reference),
      cancelUrl: callbackUrl(reference, true),
    })
  } catch (error) {
    if (!error.outcomeUnknown) await promotionModel.failPendingPayment(reference)
    throw error
  }
  await promotionModel.saveCheckoutSession(reference, checkout)
  return res.status(201).json({
    authorizationUrl: checkout.checkout_url,
    reference,
    amount: pending.package.price,
    currency: 'NGN',
    promotionId: pending.id,
  })
}

async function verify(req, res) {
  checkValidation(req)
  const payment = await promotionModel.getPaymentByReference(req.params.reference, req.user.id)
  if (!payment) return res.status(404).json({ message: 'Payment reference not found.' })
  if (payment.payment_status === 'succeeded') {
    return res.json({ status: 'succeeded', promotionStatus: payment.promotion_status, promotionId: payment.promotion_id })
  }
  if (!payment.provider_checkout_id) {
    return res.json({ status: 'pending', message: 'Bachs has not confirmed this payment yet.' })
  }
  const checkout = await bachsService.getCheckout(payment.provider_checkout_id)
  if (checkout.payment_status === 'paid') {
    const result = await promotionModel.completeVerifiedPayment(payment.provider_checkout_id, checkout)
    return res.json({
      status: 'succeeded',
      promotionStatus: result.status,
      promotionId: result.promotionId,
      alreadyProcessed: result.alreadyProcessed,
    })
  }
  if (checkout.status === 'expired') {
    await promotionModel.failPendingPayment(payment.provider_reference)
  }
  return res.json({
    status: checkout.status === 'expired' ? 'failed' : 'pending',
    message: checkout.status === 'expired'
      ? 'This checkout expired before Bachs confirmed payment.'
      : 'Bachs has not confirmed this payment yet.',
  })
}

async function webhook(req, res) {
  let event
  try {
    event = bachsService.constructEvent(req.rawBody, req.headers)
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message })
    return res.status(401).json({ message: 'Bachs webhook signature could not be verified.' })
  }
  const checkoutId = event.data?.checkout_id
  if (!checkoutId) return res.json({ received: true })

  if (event.type === 'checkout.expired') {
    await promotionModel.failPendingPaymentByCheckoutId(checkoutId, event)
    return res.json({ received: true })
  }
  if (event.type === 'collection.failed') return res.json({ received: true })

  const isSuccessfulCollection = event.type === 'collection.succeeded' && event.data?.status === 'SUCCEEDED'
  const isPaidCheckout = event.type === 'checkout.completed' && event.data?.payment_status === 'paid'
  if (!isSuccessfulCollection && !isPaidCheckout) return res.json({ received: true })

  const payment = await promotionModel.getPaymentByCheckoutId(checkoutId)
  if (!payment) return res.json({ received: true })
  const checkout = await bachsService.getCheckout(checkoutId)
  await promotionModel.completeVerifiedPayment(checkoutId, checkout, {
    id: event.id,
    type: event.type,
  })
  return res.json({ received: true })
}

async function adminPackages(req, res) {
  return res.json({ packages: await promotionModel.listPackages() })
}

async function savePackage(req, res) {
  checkValidation(req)
  const packageId = await promotionModel.savePackage({
    id: req.params.id ? Number(req.params.id) : null,
    name: req.body.name.trim(),
    description: req.body.description?.trim() || '',
    price: Number(req.body.price),
    durationDays: Number(req.body.durationDays),
    benefits: req.body.benefits?.trim() || '',
    isActive: req.body.isActive === undefined ? true : req.body.isActive,
  })
  return res.status(req.params.id ? 200 : 201).json({ packageId })
}

async function adminPromotions(req, res) {
  checkValidation(req)
  const { page, limit } = pageArgs(req.query)
  const result = await promotionModel.listAdminPromotions({ status: req.query.status || null, page, limit })
  return res.json({ ...result, pagination: { page, limit, total: result.total, pages: Math.ceil(result.total / limit) } })
}

async function moderatePromotion(req, res) {
  checkValidation(req)
  const result = await promotionModel.moderatePromotion({
    id: Number(req.params.id),
    administratorId: req.user.id,
    status: req.body.status,
    reqMeta: { ipAddress: req.ip, userAgent: req.get('user-agent') },
  })
  if (!result) return res.status(404).json({ message: 'Promotion not found.' })
  return res.json({ message: `Promotion ${req.body.status}.` })
}

async function monetization(req, res) {
  checkValidation(req)
  return res.json(await promotionModel.getMonetization({ from: req.query.from || null, to: req.query.to || null }))
}

module.exports = {
  adminPackages,
  adminPromotions,
  featured,
  initialize,
  moderatePromotion,
  monetization,
  myPromotions,
  packages,
  savePackage,
  track,
  verify,
  webhook,
}