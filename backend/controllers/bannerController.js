const { validationResult } = require('express-validator')
const bannerModel = require('../models/bannerModel')
const { BANNER_HEIGHT, BANNER_WIDTH, validateBannerImage } = require('../utils/bannerImage')

function fail(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function checkValidation(req) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) throw fail(errors.array()[0].msg)
}

function optionalText(value) {
  const text = String(value ?? '').trim()
  return text || null
}

function optionalDate(value, label) {
  const text = optionalText(value)
  if (!text) return null
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) throw fail(`${label} is not a valid date.`)
  return date.toISOString()
}

function fieldsFrom(req) {
  const title = String(req.body.title ?? '').trim()
  if (title.length < 2 || title.length > 120) throw fail('Give the banner a title of 2 to 120 characters.')
  const linkUrl = optionalText(req.body.linkUrl)
  if (linkUrl) {
    let parsed
    try { parsed = new URL(linkUrl) } catch { throw fail('The banner link must be a full web address.') }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw fail('The banner link must start with http:// or https://.')
  }
  const startsAt = optionalDate(req.body.startsAt, 'The start date')
  const endsAt = optionalDate(req.body.endsAt, 'The end date')
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) throw fail('The end date must be after the start date.')
  const sortOrder = Number.parseInt(req.body.sortOrder, 10)
  return {
    title,
    advertiser: optionalText(req.body.advertiser)?.slice(0, 120) ?? null,
    linkUrl,
    altText: optionalText(req.body.altText)?.slice(0, 200) ?? null,
    sortOrder: Number.isFinite(sortOrder) ? Math.max(-1000, Math.min(1000, sortOrder)) : 0,
    isActive: String(req.body.isActive ?? 'true') !== 'false',
    startsAt,
    endsAt,
  }
}

function imageFrom(req) {
  if (!req.file) return null
  const details = validateBannerImage(req.file.buffer)
  return { data: req.file.buffer, contentType: details.contentType, width: details.width, height: details.height }
}

// ---- Public ----
async function listPublic(req, res) {
  res.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600')
  const banners = await bannerModel.listPublic()
  return res.json({
    banners: banners.map((banner) => ({
      id: banner.id,
      title: banner.title,
      linkUrl: banner.link_url,
      altText: banner.alt_text || banner.title,
      imageUrl: `/api/banners/${banner.id}/image?v=${new Date(banner.updated_at).getTime()}`,
    })),
    size: { width: BANNER_WIDTH, height: BANNER_HEIGHT },
  })
}

async function image(req, res) {
  const banner = await bannerModel.getImage(req.params.id)
  if (!banner) return res.status(404).json({ message: 'Banner not found.' })
  res.set({
    'Content-Type': banner.content_type,
    // The URL carries ?v=<updated time>, so a replaced image gets a new address.
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  })
  return res.send(banner.image_data)
}

// ---- Admin ----
async function adminList(req, res) {
  return res.json({
    banners: await bannerModel.listAll(),
    size: { width: BANNER_WIDTH, height: BANNER_HEIGHT, recommended: `${BANNER_WIDTH * 2} x ${BANNER_HEIGHT * 2}` },
  })
}

async function adminImage(req, res) {
  checkValidation(req)
  const banner = await bannerModel.getImageAny(req.params.id)
  if (!banner) throw fail('Banner not found.', 404)
  res.set({ 'Content-Type': banner.content_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
  return res.send(banner.image_data)
}

async function create(req, res) {
  checkValidation(req)
  const fields = fieldsFrom(req)
  const image = imageFrom(req)
  if (!image) throw fail('Choose a banner image to upload.')
  return res.status(201).json({ banner: await bannerModel.create({ ...fields, image }) })
}

async function update(req, res) {
  checkValidation(req)
  const fields = fieldsFrom(req)
  const banner = await bannerModel.update(req.params.id, { ...fields, image: imageFrom(req) })
  if (!banner) throw fail('Banner not found.', 404)
  return res.json({ banner })
}

async function remove(req, res) {
  checkValidation(req)
  if (!(await bannerModel.remove(req.params.id))) throw fail('Banner not found.', 404)
  return res.json({ message: 'Banner deleted.' })
}

module.exports = { adminImage, adminList, create, image, listPublic, remove, update }
