const { randomUUID } = require('node:crypto')
const bannerOrderModel = require('../models/bannerOrderModel')
const paystackService = require('../services/paystackService')
const { BANNER_HEIGHT, BANNER_WIDTH, validateBannerImage } = require('../utils/bannerImage')

function fail(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function callbackUrl(reference) {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim()
  const url = new URL('/advertise', frontendUrl)
  url.searchParams.set('banner_reference', reference)
  return url.toString()
}

function orderFields(req) {
  const title = String(req.body.title ?? '').trim()
  if (title.length < 2 || title.length > 120) throw fail('Give your banner a title of 2 to 120 characters.')
  const rawLink = String(req.body.linkUrl ?? '').trim()
  let linkUrl = null
  if (rawLink) {
    let parsed
    try { parsed = new URL(rawLink) } catch { throw fail('The banner link must be a full web address.') }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw fail('The banner link must start with http:// or https://.')
    linkUrl = rawLink.slice(0, 2048)
  }
  const altText = String(req.body.altText ?? '').trim().slice(0, 200) || null
  const days = Number.parseInt(req.body.days, 10)
  if (!Number.isInteger(days) || days < bannerOrderModel.MIN_DAYS || days > bannerOrderModel.MAX_DAYS) {
    throw fail(`Choose between ${bannerOrderModel.MIN_DAYS} and ${bannerOrderModel.MAX_DAYS} days.`)
  }
  return { title, linkUrl, altText, days }
}

async function pricing(req, res) {
  res.set('Cache-Control', 'public, max-age=60')
  return res.json({
    pricePerDay: await bannerOrderModel.getPricePerDay(),
    minDays: bannerOrderModel.MIN_DAYS,
    maxDays: bannerOrderModel.MAX_DAYS,
    currency: 'NGN',
    size: { width: BANNER_WIDTH, height: BANNER_HEIGHT, recommended: `${BANNER_WIDTH * 2} x ${BANNER_HEIGHT * 2}` },
  })
}

async function createOrder(req, res) {
  if (!paystackService.getSecretKey()) throw fail('Banner checkout is temporarily unavailable. Please try again later.', 503)
  const fields = orderFields(req)
  if (!req.file) throw fail('Choose a banner image to upload.')
  const details = validateBannerImage(req.file.buffer)
  const image = { data: req.file.buffer, contentType: details.contentType, width: details.width, height: details.height }

  const pricePerDay = await bannerOrderModel.getPricePerDay()
  const amount = bannerOrderModel.totalFor(fields.days, pricePerDay)
  const reference = randomUUID()
  const order = await bannerOrderModel.createOrder({
    userId: req.user.id, title: fields.title, linkUrl: fields.linkUrl, altText: fields.altText,
    image, days: fields.days, reference, amount,
  })

  let transaction
  try {
    transaction = await paystackService.initializeTransaction({
      email: req.user.email,
      reference,
      amount,
      callbackUrl: callbackUrl(reference),
      metadata: { type: 'banner', bannerId: order.bannerId, days: fields.days },
    })
  } catch (error) {
    await bannerOrderModel.failOrder(reference)
    throw error
  }
  return res.status(201).json({
    authorizationUrl: transaction.authorization_url,
    reference,
    amount,
    days: fields.days,
    currency: 'NGN',
    bannerId: order.bannerId,
  })
}

async function verifyOrder(req, res) {
  const order = await bannerOrderModel.getOrderByReference(req.params.reference, req.user.id)
  if (!order) throw fail('Payment reference not found.', 404)
  if (order.payment_status === 'succeeded') {
    return res.json({ status: 'succeeded', bannerStatus: order.banner_status, bannerId: order.banner_id })
  }
  const checkout = await paystackService.getCheckout(order.provider_reference)
  if (checkout.payment_status === 'paid') {
    const result = await bannerOrderModel.completePayment(order.provider_reference, checkout)
    return res.json({ status: 'succeeded', bannerStatus: result.status, bannerId: result.bannerId })
  }
  if (checkout.status === 'expired') {
    await bannerOrderModel.failOrder(order.provider_reference)
    return res.json({ status: 'failed', message: 'The payment was not completed.' })
  }
  return res.json({ status: 'pending', message: 'Paystack has not confirmed this payment yet.' })
}

async function listMine(req, res) {
  return res.json({ banners: await bannerOrderModel.listMine(req.user.id) })
}

// ---- Admin ----
async function approve(req, res) {
  if (!(await bannerOrderModel.approve(req.params.id))) throw fail('Only banners waiting for review can be approved.', 409)
  return res.json({ message: 'Banner approved. It is live now and will run for the days that were paid for.' })
}

async function reject(req, res) {
  const note = String(req.body.note ?? '').trim()
  if (note.length < 3 || note.length > 500) throw fail('Give the advertiser a reason of 3 to 500 characters.')
  if (!(await bannerOrderModel.reject(req.params.id, note))) throw fail('Only banners waiting for review can be rejected.', 409)
  return res.json({ message: 'Banner rejected. Refund the payment in Paystack if it should not be kept.' })
}

async function getSettings(req, res) {
  return res.json({ pricePerDay: await bannerOrderModel.getPricePerDay(), minDays: bannerOrderModel.MIN_DAYS, maxDays: bannerOrderModel.MAX_DAYS })
}

async function setSettings(req, res) {
  return res.json({ pricePerDay: await bannerOrderModel.setPricePerDay(String(req.body.pricePerDay ?? '').trim()) })
}

module.exports = { approve, createOrder, getSettings, listMine, pricing, reject, setSettings, verifyOrder }
