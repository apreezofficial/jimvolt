const { randomUUID } = require('node:crypto')
const { validationResult } = require('express-validator')
const promotionModel = require('../models/promotionModel')
const paystackService = require('../services/paystackService')
const { verifyPaystackSignature } = require('../utils/paystackWebhook')

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
  if (!paystackService.getSecretKey()) {
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
    checkout = await paystackService.createPromotionCheckout({
      email: req.user.email,
      reference,
      amount: pending.package.price,
      promotionId: pending.id,
      callbackUrl: callbackUrl(reference),
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
    return res.json({ status: 'pending', message: 'Paystack has not confirmed this payment yet.' })
  }
  const checkout = await paystackService.getCheckout(payment.provider_checkout_id)
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
      ? 'This checkout expired before Paystack confirmed payment.'
      : 'Paystack has not confirmed this payment yet.',
  })
}

async function webhook(req, res) {
  const signature = req.headers['x-paystack-signature']
  if (!verifyPaystackSignature(req.rawBody, signature, paystackService.getSecretKey())) {
    return res.status(401).json({ message: 'Paystack webhook signature could not be verified.' })
  }

  let event
  try {
    event = JSON.parse(req.rawBody.toString('utf8'))
  } catch {
    return res.status(400).json({ message: 'Invalid webhook payload.' })
  }
  const reference = event.data?.reference
  if (!reference) return res.json({ received: true })
  // Paystack events carry no event id, so the transaction id plus event type identifies one delivery.
  const eventRecord = { id: `${event.event}:${event.data?.id}`, type: event.event }

  if (event.event === 'charge.failed') {
    await promotionModel.failPendingPaymentByCheckoutId(reference, eventRecord)
    return res.json({ received: true })
  }
  if (event.event !== 'charge.success') return res.json({ received: true })

  const payment = await promotionModel.getPaymentByCheckoutId(reference)
  if (!payment) return res.json({ received: true })
  // Confirm with Paystack directly rather than trusting the webhook body alone.
  const checkout = await paystackService.getCheckout(reference)
  await promotionModel.completeVerifiedPayment(reference, checkout, eventRecord)
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