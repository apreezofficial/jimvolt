const { validationResult } = require('express-validator')
const { randomUUID } = require('node:crypto')
const { maxFiles } = require('../middleware/productImageUpload')
const adModel = require('../models/adModel')
const categoryModel = require('../models/categoryModel')
const userModel = require('../models/userModel')
const sellerModel = require('../models/sellerModel')
const { buildFilters, normalizeState, sortOrders, randomOrder } = require('../utils/adSearch')
const { removeProductImages, storeProductImages } = require('../utils/productImageStorage')

function validationError(req) {
  const errors = validationResult(req)
  if (errors.isEmpty()) return
  const error = new Error(errors.array()[0].msg)
  error.statusCode = 400
  throw error
}

function pagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20))
  return { page, limit, offset: (page - 1) * limit }
}

async function list(req, res) {
  validationError(req)
  const { page, limit, offset } = pagination(req.query)
  const { where, values } = buildFilters(req.query)
  const orderBy = req.query.sort === 'random' ? randomOrder(req.query.seed) : sortOrders[req.query.sort] || sortOrders.newest
  const [advertisements, total] = await Promise.all([
    adModel.findPublic({ where, values, orderBy, limit, offset }),
    adModel.countPublic({ where, values }),
  ])
  const totalPages = Math.ceil(total / limit)
  // Public listings carry no per-user data, so browsers and the CDN can reuse them briefly.
  res.set('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300')
  return res.json({
    advertisements,
    totalResults: total,
    totalPages,
    pagination: { page, limit, total, pages: totalPages },
  })
}

async function suggestions(req, res) {
  validationError(req)
  const q = String(req.query.q || '').trim()
  if (q.length < 2) return res.json({ suggestions: [] })
  return res.json({ suggestions: await adModel.findSearchSuggestions(q) })
}

async function cities(req, res) {
  validationError(req)
  return res.json({ cities: await adModel.findCitiesByState(normalizeState(req.query.state)) })
}

async function popularLocations(req, res) {
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600')
  return res.json({ locations: await adModel.findPopularLocations() })
}

async function getSeller(req, res) {
  validationError(req)
  const seller = await userModel.findPublicSeller(req.params.id)
  if (!seller) return res.status(404).json({ message: 'Seller not found.' })
  const advertisements = await adModel.findPublicBySeller(req.params.id)
  const businessProfile = await sellerModel.getPublicProfileByUserId(req.params.id)
  return res.json({ seller: { ...seller, businessProfile }, advertisements })
}

async function getById(req, res) {
  validationError(req)
  const advertisement = await adModel.findPublicById(req.params.id)
  if (!advertisement) return res.status(404).json({ message: 'Advertisement not found.' })
  await adModel.incrementViews(req.params.id)
  advertisement.views += 1
  if (req.user) {
    await require('../models/discoveryModel').trackView(req.user.id, advertisement.id)
  }
  return res.json({ advertisement })
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 170)
  return `${slug || 'advertisement'}-${randomUUID()}`
}

function validateImages(images) {
  if (images === undefined) return []
  if (typeof images === 'string') {
    try { images = JSON.parse(images) } catch {
      const error = new Error('Product images must be a valid image list.')
      error.statusCode = 400
      throw error
    }
  }
  if (!Array.isArray(images) || images.length > maxFiles) {
    const error = new Error(`Product images must be a list containing no more than ${maxFiles} images.`)
    error.statusCode = 400
    throw error
  }
  for (const image of images) {
    if (typeof image !== 'string' || image.length > 2048) {
      const error = new Error('Each product image must be a URL or uploaded image path no longer than 2048 characters.')
      error.statusCode = 400
      throw error
    }
    if (/^\/uploads\/products\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/i.test(image)) continue
    try {
      const url = new URL(image)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    } catch {
      const error = new Error('Each product image must be a valid HTTP or HTTPS URL or uploaded image path.')
      error.statusCode = 400
      throw error
    }
  }
  return images
}

async function save(req, res, isUpdate) {
  const uploadedImages = await storeProductImages(req.files, req.user.id)
  try {
    validationError(req)
    const category = await categoryModel.findByIdOrSlug(String(req.body.categoryId))
    if (!category) {
      const error = new Error('The selected category does not exist.')
      error.statusCode = 400
      throw error
    }
    const images = [...validateImages(req.body.images), ...uploadedImages.map((image) => image.url)]
    if (images.length > maxFiles) {
      const error = new Error(`You can attach up to ${maxFiles} images.`)
      error.statusCode = 400
      throw error
    }
    const fields = {
      categoryId: category.id,
      title: req.body.title.trim(),
      brand: req.body.brand?.trim() || null,
      specifications: req.body.specifications?.trim() || null,
      slug: slugify(req.body.title),
      description: req.body.description.trim(),
      price: Number(req.body.price),
      conditionType: req.body.conditionType,
      state: req.body.state.trim(),
      city: req.body.city.trim(),
      phone: req.body.phone.trim(),
      whatsapp: req.body.whatsapp?.trim() || null,
      images,
    }

    if (isUpdate) {
      const updated = await adModel.updateOwned(req.params.id, req.user.id, fields)
      if (!updated) {
        const error = new Error('Advertisement not found.')
        error.statusCode = 404
        throw error
      }
      return res.json({ message: 'Advertisement updated and submitted for review.', id: Number(req.params.id) })
    }

    const id = await adModel.create({ ...fields, userId: req.user.id })
    return res.status(201).json({ message: 'Advertisement submitted for review.', id })
  } catch (error) {
    await removeProductImages(uploadedImages, req.user.id).catch((cleanupError) => {
      console.error('Could not clean up product images after an unsuccessful advertisement save:', cleanupError)
    })
    throw error
  }
}

async function create(req, res) {
  return save(req, res, false)
}

async function update(req, res) {
  return save(req, res, true)
}

async function remove(req, res) {
  validationError(req)
  const deleted = await adModel.deleteOwned(req.params.id, req.user.id)
  if (!deleted) return res.status(404).json({ message: 'Advertisement not found.' })
  return res.status(204).end()
}

module.exports = { cities, create, getById, getSeller, list, popularLocations, remove, suggestions, update }
