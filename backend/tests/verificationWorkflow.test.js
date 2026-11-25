const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const express = require('express')
const jwt = require('jsonwebtoken')
const adminRoutes = require('../routes/adminRoutes')
const sellerRoutes = require('../routes/sellerRoutes')
const { errorHandler } = require('../middleware/errorMiddleware')
const categoryModel = require('../models/categoryModel')
const sellerModel = require('../models/sellerModel')
const userModel = require('../models/userModel')

test('seller submits private documents, admins review them, and sellers cannot download them', async (t) => {
  const savedEnvironment = new Map(
    ['JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
      .map((key) => [key, process.env[key]]),
  )
  const originalFetch = global.fetch
  const originalMethods = {
    findById: userModel.findById,
    findByIdOrSlug: categoryModel.findByIdOrSlug,
    getVerification: sellerModel.getVerification,
    getVerificationDocument: sellerModel.getVerificationDocument,
    requestVerificationInfo: sellerModel.requestVerificationInfo,
    reviewVerification: sellerModel.reviewVerification,
    submitVerification: sellerModel.submitVerification,
  }
  process.env.JWT_SECRET = 'verification-workflow-test-secret-at-least-32-characters'
  process.env.SUPABASE_URL = 'https://jimvolt-test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

  const objects = new Map()
  let verification = { id: 7, user_id: 42, status: 'not_submitted' }
  const seller = { id: 42, account_status: 'active', token_version: 0, role: 'user' }
  const admin = { id: 99, account_status: 'active', token_version: 0, role: 'admin' }
  userModel.findById = async (id) => (String(id) === '99' ? admin : seller)
  categoryModel.findByIdOrSlug = async () => ({ id: 1 })
  sellerModel.submitVerification = async (userId, submitted) => {
    assert.equal(userId, 42)
    verification = {
      id: 7,
      user_id: 42,
      status: 'pending',
      documents: { ...verification.documents, ...submitted.documents },
      has_identity_document: Boolean(
        submitted.documents.identityDocument || verification.documents?.identityDocument,
      ),
    }
    return 7
  }
  sellerModel.getVerification = async () => verification
  sellerModel.getVerificationDocument = async (id, type) => {
    assert.equal(String(id), '7')
    return verification.documents?.[
      { cac: 'cacDocument', identity: 'identityDocument', additional: 'additionalDocument' }[type]
    ] || null
  }
  sellerModel.requestVerificationInfo = async () => {
    verification.status = 'information_requested'
    return true
  }
  sellerModel.reviewVerification = async (id, reviewerId, status) => {
    assert.equal(String(id), '7')
    assert.equal(reviewerId, 99)
    verification.status = status
    return 42
  }

  global.fetch = async (url, options = {}) => {
    const requestUrl = new URL(url)
    if (requestUrl.hostname !== 'jimvolt-test.supabase.co') return originalFetch(url, options)
    if (options.method === 'PUT' && requestUrl.searchParams.has('token')) {
      const objectPath = decodeURIComponent(requestUrl.pathname.split('/object/upload/sign/seller-verification-private/')[1])
      objects.set(objectPath, { data: Buffer.from(options.body), contentType: options.headers['Content-Type'] })
      return new Response('', { status: 200 })
    }
    if (requestUrl.pathname.includes('/object/upload/sign/')) {
      const objectPath = decodeURIComponent(requestUrl.pathname.split('/object/upload/sign/')[1])
      return new Response(JSON.stringify({
        signedURL: `/object/upload/sign/${objectPath}?token=single-use-token`,
      }), { status: 200 })
    }
    if (requestUrl.pathname.includes('/object/authenticated/')) {
      const objectPath = decodeURIComponent(requestUrl.pathname.split('/object/authenticated/seller-verification-private/')[1])
      const object = objects.get(objectPath)
      return object
        ? new Response(object.data, { status: 200, headers: { 'content-type': object.contentType } })
        : new Response('', { status: 404 })
    }
    if (options.method === 'DELETE') {
      const { prefixes } = JSON.parse(options.body)
      prefixes.forEach((prefix) => objects.delete(prefix))
      return new Response('', { status: 200 })
    }
    throw new Error(`Unexpected storage request: ${options.method || 'GET'} ${requestUrl}`)
  }

  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/seller', sellerRoutes)
  app.use('/api/admin', adminRoutes)
  app.use(errorHandler)
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`
  const sellerToken = jwt.sign({ sub: '42', tokenVersion: 0 }, process.env.JWT_SECRET)
  const adminToken = jwt.sign({ sub: '99', tokenVersion: 0 }, process.env.JWT_SECRET)
  const sellerHeaders = { Authorization: `Bearer ${sellerToken}` }
  const adminHeaders = { Authorization: `Bearer ${adminToken}` }
  const form = {
    verificationType: 'registered_business',
    businessName: 'Solar Seller Ltd',
    businessOwner: 'Jane Seller',
    businessPhone: '08031234567',
    businessAddress: '12 Solar Street, Lagos',
    documents: {},
  }

  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    global.fetch = originalFetch
    Object.assign(userModel, { findById: originalMethods.findById })
    Object.assign(categoryModel, { findByIdOrSlug: originalMethods.findByIdOrSlug })
    Object.assign(sellerModel, {
      getVerification: originalMethods.getVerification,
      getVerificationDocument: originalMethods.getVerificationDocument,
      requestVerificationInfo: originalMethods.requestVerificationInfo,
      reviewVerification: originalMethods.reviewVerification,
      submitVerification: originalMethods.submitVerification,
    })
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  async function submitDocumentAndVerification() {
    const signedResponse = await fetch(`${baseUrl}/seller/verification/upload-urls`, {
      method: 'POST',
      headers: { ...sellerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documents: [{ field: 'identityDocument', mimeType: 'application/pdf', size: 23 }],
      }),
    })
    assert.equal(signedResponse.status, 200)
    const [{ path: documentPath, uploadUrl, mimeType }] = (await signedResponse.json()).uploads
    const uploaded = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: Buffer.from('%PDF-1.7 seller verification'),
    })
    assert.equal(uploaded.status, 200)

    const response = await fetch(`${baseUrl}/seller/verification`, {
      method: 'POST',
      headers: { ...sellerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, documents: { identityDocument: documentPath } }),
    })
    assert.equal(response.status, 201)
    return documentPath
  }

  const firstPath = await submitDocumentAndVerification()
  assert.equal(verification.status, 'pending')
  assert.equal(verification.documents.identityDocument, firstPath)

  const sellerDownload = await fetch(`${baseUrl}/admin/verifications/7/document/identity`, {
    headers: sellerHeaders,
  })
  assert.equal(sellerDownload.status, 403)

  const adminDownload = await fetch(`${baseUrl}/admin/verifications/7/document/identity`, {
    headers: adminHeaders,
  })
  assert.equal(adminDownload.status, 200)
  assert.equal(adminDownload.headers.get('cache-control'), 'private, no-store')
  assert.equal(adminDownload.headers.get('content-type'), 'application/pdf')
  assert.match(adminDownload.headers.get('content-disposition'), /attachment/)
  assert.equal(await adminDownload.text(), '%PDF-1.7 seller verification')

  const infoRequest = await fetch(`${baseUrl}/admin/verifications/7/request-information`, {
    method: 'PUT',
    headers: { ...adminHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Please provide an updated certificate.' }),
  })
  assert.equal(infoRequest.status, 200)
  assert.equal(verification.status, 'information_requested')

  const resubmissionWithoutNewFile = await fetch(`${baseUrl}/seller/verification`, {
    method: 'PUT',
    headers: { ...sellerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...form, documents: {} }),
  })
  assert.equal(resubmissionWithoutNewFile.status, 201)
  assert.equal(verification.status, 'pending')
  assert.equal(verification.documents.identityDocument, firstPath)

  const secondInfoRequest = await fetch(`${baseUrl}/admin/verifications/7/request-information`, {
    method: 'PUT',
    headers: { ...adminHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Please provide an updated certificate.' }),
  })
  assert.equal(secondInfoRequest.status, 200)
  assert.equal(verification.status, 'information_requested')

  const secondPath = await submitDocumentAndVerification()
  assert.notEqual(secondPath, firstPath)
  assert.equal(verification.status, 'pending')

  const rejection = await fetch(`${baseUrl}/admin/verifications/7/status`, {
    method: 'PATCH',
    headers: { ...adminHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'rejected', notes: 'The submitted certificate could not be verified.' }),
  })
  assert.equal(rejection.status, 200)
  assert.equal(verification.status, 'rejected')

  const resubmission = await submitDocumentAndVerification()
  assert.notEqual(resubmission, secondPath)
  assert.equal(verification.status, 'pending')

  const approval = await fetch(`${baseUrl}/admin/verifications/7/status`, {
    method: 'PATCH',
    headers: { ...adminHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'verified', notes: '' }),
  })
  assert.equal(approval.status, 200)
  assert.equal(verification.status, 'verified')
})
