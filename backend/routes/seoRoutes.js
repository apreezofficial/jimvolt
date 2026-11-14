const fs = require('node:fs/promises')
const path = require('node:path')
const express = require('express')
const adModel = require('../models/adModel')
const categoryModel = require('../models/categoryModel')
const sellerModel = require('../models/sellerModel')
const userModel = require('../models/userModel')
const { pool } = require('../config/database')
const {
  advertisementPath, escapeHtml, getPublicSiteUrl, plainText, safeJson,
} = require('../utils/seo')

const router = express.Router()
const frontendBuild = path.resolve(__dirname, '../../frontend/dist')
const sitemapPageSize = 40000

function setPublicCache(res) {
  res.set('Cache-Control', 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600')
}

function metaTags({ title, description, canonical, image, type = 'website', robots = 'index,follow' }) {
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta name="robots" content="${escapeHtml(robots)}">`,
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta property="og:type" content="${escapeHtml(type)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
  ]
  if (image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(image)}">`)
    tags.push(`<meta name="twitter:image" content="${escapeHtml(image)}">`)
  }
  if (process.env.GOOGLE_SITE_VERIFICATION) {
    tags.push(`<meta name="google-site-verification" content="${escapeHtml(process.env.GOOGLE_SITE_VERIFICATION)}">`)
  }
  return tags.join('\n')
}

// The frontend HTML shell rarely changes. Fetching it over HTTP on every page view slowed
// listing and shared-profile pages and made them fail whenever that fetch failed.
const TEMPLATE_TTL_MS = 5 * 60 * 1000
let cachedTemplate = null
let cachedTemplateAt = 0

async function loadTemplate() {
  if (cachedTemplate && Date.now() - cachedTemplateAt < TEMPLATE_TTL_MS) return cachedTemplate
  try {
    cachedTemplate = await readTemplate()
    cachedTemplateAt = Date.now()
    return cachedTemplate
  } catch (error) {
    if (cachedTemplate) return cachedTemplate
    try {
      return await fs.readFile(path.join(frontendBuild, 'index.html'), 'utf8')
    } catch {
      throw error
    }
  }
}

async function readTemplate() {
  if (process.env.JIMVOLT_FRONTEND_URL) {
    const frontendUrl = new URL('/', process.env.JIMVOLT_FRONTEND_URL)
    if (!['http:', 'https:'].includes(frontendUrl.protocol)) {
      throw new Error('JIMVOLT_FRONTEND_URL must use HTTP or HTTPS.')
    }

    const response = await fetch(frontendUrl)
    if (!response.ok) {
      throw new Error(`Could not load the frontend HTML template (${response.status}).`)
    }
    return response.text()
  }

  return fs.readFile(path.join(frontendBuild, 'index.html'), 'utf8')
}

function injectHead(template, { metadata, structuredData = [], siteName = 'Jimvolt' }) {
  const canonicalPattern = /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi
  const metadataPattern = /<meta\b(?=[^>]*\b(?:name|property)=["'](?:description|robots|og:title|og:description|og:type|og:url|og:image|twitter:card|twitter:title|twitter:description|twitter:image|google-site-verification)["'])[^>]*>/gi
  const html = template
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(canonicalPattern, '')
    .replace(metadataPattern, '')
  const scripts = structuredData.map((item, index) =>
    `<script id="jimvolt-jsonld-${index + 1}" type="application/ld+json">${safeJson(item)}</script>`,
  ).join('\n')
  const tags = `${metaTags(metadata)}\n<meta property="og:site_name" content="${escapeHtml(siteName)}">\n${scripts}`
  return html.replace('</head>', `${tags}\n</head>`)
}

function renderContent(template, { metadata, structuredData, content, status = 200 }) {
  return {
    status,
    html: injectHead(template, { metadata, structuredData }),
  }
}

function breadcrumbSchema(siteUrl, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: new URL(item.path, siteUrl).href,
    })),
  }
}

function siteSchemas(siteUrl) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Jimvolt',
      url: siteUrl,
      logo: new URL('/favicon.svg', siteUrl).href,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Jimvolt',
      url: siteUrl,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${siteUrl}/search?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  ]
}

function sendRendered(res, template, page, cache = true) {
  res.status(page.status || 200)
  res.type('html')
  if (cache) setPublicCache(res)
  else res.set('Cache-Control', 'no-store')
  return res.send(page.html)
}

function productDescription(ad) {
  const intro = `${ad.title} for sale in ${ad.city}, ${ad.state}, Nigeria.`
  const details = plainText(ad.description).slice(0, 230)
  return `${intro}${details ? ` ${details}` : ''}`.slice(0, 320)
}

function productSchema(ad, siteUrl) {
  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: ad.title,
    description: plainText(ad.description),
    category: ad.category?.name,
    image: ad.images || [],
    sku: String(ad.id),
    offers: {
      '@type': 'Offer',
      url: new URL(advertisementPath(ad), siteUrl).href,
      priceCurrency: 'NGN',
      price: String(ad.price),
      itemCondition: ad.condition_type === 'new'
        ? 'https://schema.org/NewCondition'
        : 'https://schema.org/UsedCondition',
    },
  }
  if (ad.seller?.name) {
    product.seller = {
      '@type': 'Person',
      name: ad.seller.name,
    }
  }
  return product
}

function escapeInlineJsonLd(schema) {
  return `<script id="jimvolt-jsonld" type="application/ld+json">${safeJson(schema)}</script>`
}

async function renderPublicPage(req, res, next) {
  let template
  try {
    template = await loadTemplate()
  } catch (error) {
    if (error.code === 'ENOENT') return next()
    return next(error)
  }

  const siteUrl = getPublicSiteUrl()
  const pathname = req.path

  if (pathname === '/') {
    const title = 'Jimvolt | Buy and Sell Solar, Inverters and Batteries in Nigeria'
    const description = 'Compare solar panels, inverters, batteries and renewable energy products from sellers across Nigeria.'
    const content = `<main><h1>Renewable energy products and services in Nigeria</h1><p>${escapeHtml(description)}</p><a href="/ads">Browse approved advertisements</a></main>`
    const page = renderContent(template, {
      metadata: { title, description, canonical: siteUrl, image: new URL('/jimvolt-logo.png', siteUrl).href, type: 'website' },
      structuredData: siteSchemas(siteUrl),
    })
    page.html = page.html.replace('<div id="root"></div>', `<div id="root">${content}</div>`)
    return sendRendered(res, template, page)
  }

  const productMatch = pathname.match(/^\/ads\/([a-z0-9-]+)$/i)
  if (productMatch) {
    const identifier = productMatch[1]
    const idMatch = identifier.match(/(?:^|[-])(\d+)$/)
    const id = idMatch ? idMatch[1] : identifier
    if (!/^\d+$/.test(id)) return next()
    const ad = await adModel.findPublicById(id)
    if (!ad) {
      const page = renderContent(template, {
        metadata: {
          title: 'Advertisement unavailable | Jimvolt',
          description: 'This advertisement is unavailable. Browse current renewable energy listings on Jimvolt.',
          canonical: new URL(pathname, siteUrl).href,
          robots: 'noindex,follow',
        },
        structuredData: [],
        status: 404,
      })
      page.html = page.html.replace('<div id="root"></div>', '<div id="root"><main><h1>Advertisement unavailable</h1><p>This listing may have expired or been removed.</p><a href="/ads">Browse advertisements</a></main></div>')
      return sendRendered(res, template, page, false)
    }
    const canonicalPath = advertisementPath(ad)
    const canonical = new URL(canonicalPath, siteUrl).href
    const title = `${ad.title} for Sale in ${ad.state} | Jimvolt`.slice(0, 70)
    const description = productDescription(ad)
    const image = ad.images?.[0]
    const crumbs = breadcrumbSchema(siteUrl, [
      { name: 'Home', path: '/' },
      { name: ad.category.name, path: `/category/${ad.category.slug}` },
      { name: ad.title, path: canonicalPath },
    ])
    const productData = productSchema(ad, siteUrl)
    const body = `<main><nav aria-label="Breadcrumb"><a href="/">Home</a> &gt; <a href="/category/${escapeHtml(ad.category.slug)}">${escapeHtml(ad.category.name)}</a> &gt; ${escapeHtml(ad.title)}</nav><article><h1>${escapeHtml(ad.title)}</h1><p>${escapeHtml(ad.category.name)} · ${escapeHtml(ad.city)}, ${escapeHtml(ad.state)}</p><p>Price: ₦${escapeHtml(Number(ad.price).toLocaleString('en-NG'))}</p><p>${escapeHtml(plainText(ad.description))}</p>${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(ad.title)}" width="800" height="600">` : ''}<p>Seller: ${escapeHtml(ad.seller.name)}</p><a href="${escapeHtml(canonicalPath)}">View advertisement</a></article></main>`
    const page = renderContent(template, {
      metadata: { title, description, canonical, image, type: 'product' },
      structuredData: [productData, crumbs],
    })
    page.html = page.html.replace('<div id="root"></div>', `<div id="root">${body}</div>`)
    return sendRendered(res, template, page)
  }

  const categoryMatch = pathname.match(/^\/category\/([a-z0-9-]+)$/i)
  if (categoryMatch) {
    const category = await categoryModel.findByIdOrSlug(categoryMatch[1])
    if (!category) return next()
    const [advertisements, total] = await Promise.all([
      adModel.findPublic({
        where: "WHERE a.status = 'approved' AND c.id = ?",
        values: [category.id],
        limit: 20,
      }),
      adModel.countPublic({ where: "WHERE a.status = 'approved' AND c.id = ?", values: [category.id] }),
    ])
    const canonical = new URL(`/category/${category.slug}`, siteUrl).href
    const description = category.description
      ? `${category.description} Browse approved ${category.name.toLowerCase()} listings across Nigeria on Jimvolt.`
      : `Browse ${category.name.toLowerCase()} for sale from renewable energy sellers across Nigeria.`
    const cards = advertisements.map((ad) => `<li><a href="${escapeHtml(advertisementPath(ad))}">${escapeHtml(ad.title)}</a> — ₦${escapeHtml(Number(ad.price).toLocaleString('en-NG'))} in ${escapeHtml(ad.city)}, ${escapeHtml(ad.state)}</li>`).join('')
    const body = `<main><nav aria-label="Breadcrumb"><a href="/">Home</a> &gt; ${escapeHtml(category.name)}</nav><h1>${escapeHtml(category.name)} for Sale in Nigeria</h1><p>${escapeHtml(description)}</p><p>${total} approved listings</p><ul>${cards}</ul><a href="/ads?category=${encodeURIComponent(category.slug)}">Browse all ${escapeHtml(category.name)}</a></main>`
    const page = renderContent(template, {
      metadata: { title: `${category.name} for Sale in Nigeria | Jimvolt`, description, canonical },
      structuredData: [breadcrumbSchema(siteUrl, [
        { name: 'Home', path: '/' }, { name: category.name, path: `/category/${category.slug}` },
      ])],
    })
    page.html = page.html.replace('<div id="root"></div>', `<div id="root">${body}</div>`)
    return sendRendered(res, template, page)
  }

  const businessMatch = pathname.match(/^\/seller\/([a-z0-9-]+)$/i)
  if (businessMatch) {
    const seller = await sellerModel.getPublicProfile(businessMatch[1])
    if (!seller) return next()
    const [advertisements] = await Promise.all([
      adModel.findPublicBySeller(seller.seller_id),
    ])
    const canonical = new URL(`/seller/${seller.slug}`, siteUrl).href
    const title = `${seller.business_name} | Solar Energy Seller in ${seller.state || 'Nigeria'} | Jimvolt`
    const description = plainText(seller.description || `${seller.business_name} offers renewable energy products and services on Jimvolt.`).slice(0, 300)
    const schema = {
      '@context': 'https://schema.org',
      '@type': seller.is_verified && seller.address ? 'LocalBusiness' : 'Organization',
      name: seller.business_name,
      url: canonical,
      description,
    }
    if (seller.logo_url) schema.image = seller.logo_url
    if (seller.address) schema.address = {
      '@type': 'PostalAddress',
      streetAddress: seller.address,
      addressLocality: seller.city || undefined,
      addressRegion: seller.state || undefined,
      addressCountry: 'NG',
    }
    if (seller.is_verified) schema.additionalType = 'https://schema.org/Organization'
    const body = `<main><nav aria-label="Breadcrumb"><a href="/">Home</a> &gt; <a href="/sellers">Sellers</a> &gt; ${escapeHtml(seller.business_name)}</nav><h1>${escapeHtml(seller.business_name)}</h1>${seller.city || seller.state ? `<p>${escapeHtml([seller.city, seller.state].filter(Boolean).join(', '))}</p>` : ''}<p>${escapeHtml(description)}</p><h2>Approved advertisements</h2><ul>${advertisements.map((ad) => `<li><a href="${escapeHtml(advertisementPath(ad))}">${escapeHtml(ad.title)}</a> — ₦${escapeHtml(Number(ad.price).toLocaleString('en-NG'))}</li>`).join('')}</ul></main>`
    const page = renderContent(template, {
      metadata: { title, description, canonical, image: seller.logo_url },
      structuredData: [schema, breadcrumbSchema(siteUrl, [
        { name: 'Home', path: '/' }, { name: 'Sellers', path: '/sellers' }, { name: seller.business_name, path: `/seller/${seller.slug}` },
      ])],
    })
    page.html = page.html.replace('<div id="root"></div>', `<div id="root">${body}</div>`)
    return sendRendered(res, template, page)
  }

  const sellerMatch = pathname.match(/^\/sellers\/(\d+)$/)
  if (sellerMatch) {
    const seller = await userModel.findPublicSeller(sellerMatch[1])
    if (!seller) return next()
    const advertisements = await adModel.findPublicBySeller(seller.id)
    const canonical = new URL(`/sellers/${seller.id}`, siteUrl).href
    const description = `${seller.name} is a ${seller.isVerified ? 'verified ' : ''}renewable energy seller on Jimvolt with ${advertisements.length} approved advertisements.`
    const person = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: seller.name,
      url: canonical,
      ...(seller.profileImage ? { image: seller.profileImage } : {}),
    }
    const body = `<main><nav aria-label="Breadcrumb"><a href="/">Home</a> &gt; <a href="/sellers">Sellers</a> &gt; ${escapeHtml(seller.name)}</nav><h1>${escapeHtml(seller.name)}</h1><p>${seller.isVerified ? 'Verified seller' : 'Jimvolt marketplace seller'}</p><h2>Approved advertisements</h2><ul>${advertisements.map((ad) => `<li><a href="${escapeHtml(advertisementPath(ad))}">${escapeHtml(ad.title)}</a> — ₦${escapeHtml(Number(ad.price).toLocaleString('en-NG'))} in ${escapeHtml(ad.city)}, ${escapeHtml(ad.state)}</li>`).join('')}</ul></main>`
    const page = renderContent(template, {
      metadata: {
        title: `${seller.name} | Renewable Energy Seller | Jimvolt`,
        description,
        canonical,
        image: seller.profileImage,
      },
      structuredData: [person, breadcrumbSchema(siteUrl, [
        { name: 'Home', path: '/' }, { name: 'Sellers', path: '/sellers' }, { name: seller.name, path: `/sellers/${seller.id}` },
      ])],
    })
    page.html = page.html.replace('<div id="root"></div>', `<div id="root">${body}</div>`)
    return sendRendered(res, template, page)
  }

  if (/^\/(?:admin|dashboard|messages|login|register|profile|account-settings|saved|favourites|recently-viewed|post-ad|forgot-password|reset-password|verify-email|tests)(?:\/|$)/.test(pathname)) {
    const page = renderContent(template, {
      metadata: {
        title: 'Jimvolt',
        description: 'Jimvolt renewable energy marketplace.',
        canonical: new URL(pathname, siteUrl).href,
        robots: 'noindex,nofollow',
      },
      structuredData: [],
      content: '',
    })
    return sendRendered(res, template, page, false)
  }
  return next()
}

function xmlEscape(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

async function sitemapEntries(siteUrl) {
  const urls = [
    { loc: new URL('/', siteUrl).href },
    { loc: new URL('/ads', siteUrl).href },
    { loc: new URL('/sellers', siteUrl).href },
  ]
  const categories = await categoryModel.findAll()
  for (const category of categories) {
    urls.push({
      loc: new URL(`/category/${encodeURIComponent(category.slug)}`, siteUrl).href,
      lastmod: category.created_at,
    })
  }
  const [sellers] = await pool.execute(
    `SELECT sp.slug, sp.updated_at
     FROM seller_profiles sp
     WHERE EXISTS (
       SELECT 1 FROM advertisements a
       WHERE a.user_id = sp.user_id AND a.status = 'approved'
     )
     ORDER BY sp.id`,
  )
  for (const seller of sellers) {
    urls.push({ loc: new URL(`/seller/${encodeURIComponent(seller.slug)}`, siteUrl).href, lastmod: seller.updated_at })
  }
  let lastAdvertisementId = 0
  for (;;) {
    const [ads] = await pool.execute(
      `SELECT id, title, updated_at FROM advertisements
       WHERE status = 'approved' AND id > ? ORDER BY id LIMIT ?`,
      [lastAdvertisementId, sitemapPageSize],
    )
    for (const ad of ads) {
      urls.push({
        loc: new URL(advertisementPath(ad), siteUrl).href,
        lastmod: ad.updated_at,
      })
    }
    if (ads.length < sitemapPageSize) break
    lastAdvertisementId = ads[ads.length - 1].id
  }
  return urls
}

async function sitemap(req, res, next) {
  try {
    const siteUrl = getPublicSiteUrl()
    const urls = await sitemapEntries(siteUrl)
    const groups = []
    for (let offset = 0; offset < urls.length; offset += sitemapPageSize) {
      groups.push(urls.slice(offset, offset + sitemapPageSize))
    }
    const renderUrlSet = (entries) =>
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((entry) => `  <url><loc>${xmlEscape(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${new Date(entry.lastmod).toISOString()}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`

    res.type('application/xml')
    setPublicCache(res)
    if (groups.length <= 1) return res.send(renderUrlSet(urls))
    const index = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${groups.map((_, index) => `  <sitemap><loc>${xmlEscape(new URL(`/sitemap-${index + 1}.xml`, siteUrl).href)}</loc></sitemap>`).join('\n')}\n</sitemapindex>`
    return res.send(index)
  } catch (error) {
    return next(error)
  }
}

async function sitemapPart(req, res, next) {
  try {
    const part = Number(req.params.part)
    if (!Number.isSafeInteger(part) || part < 1) return res.status(404).end()
    const urls = await sitemapEntries(getPublicSiteUrl())
    const start = (part - 1) * sitemapPageSize
    const entries = urls.slice(start, start + sitemapPageSize)
    if (!entries.length) return res.status(404).end()
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((entry) => `  <url><loc>${xmlEscape(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${new Date(entry.lastmod).toISOString()}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`
    res.type('application/xml')
    setPublicCache(res)
    return res.send(xml)
  } catch (error) {
    return next(error)
  }
}

router.get('/sitemap.xml', sitemap)
router.get('/sitemap-:part.xml', sitemapPart)
router.get('/robots.txt', (req, res) => {
  const siteUrl = getPublicSiteUrl()
  res.type('text/plain')
  setPublicCache(res)
  return res.send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /dashboard/',
    'Disallow: /messages/',
    'Disallow: /api/',
    'Disallow: /login',
    'Disallow: /register',
    'Disallow: /profile',
    'Disallow: /account-settings',
    'Disallow: /saved',
    'Disallow: /favourites',
    'Disallow: /recently-viewed',
    'Disallow: /post-ad',
    'Disallow: /forgot-password',
    'Disallow: /reset-password',
    'Disallow: /verify-email',
    'Disallow: /tests/',
    'Disallow: /search',
    `Sitemap: ${new URL('/sitemap.xml', siteUrl).href}`,
    process.env.GOOGLE_SITE_VERIFICATION
      ? `# Google Search Console verification is published in page metadata.`
      : '',
  ].filter(Boolean).join('\n'))
})
router.get('*', (req, res, next) => renderPublicPage(req, res, next).catch(next))

module.exports = { router, frontendBuild }
