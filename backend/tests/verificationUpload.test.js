const assert = require('node:assert/strict')
const test = require('node:test')
const { parseVerificationUpload, validateDocument } = require('../middleware/verificationUpload')

const storageVariables = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
const validPdfPath = 'user_42/123e4567-e89b-42d3-a456-426614174000.pdf'

async function withStorageEnvironment(callback) {
  const previousEnvironment = new Map(storageVariables.map((key) => [key, process.env[key]]))
  const originalFetch = global.fetch
  process.env.SUPABASE_URL = 'https://jimvolt-test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  try {
    await callback()
  } finally {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    global.fetch = originalFetch
  }
}

function requestWithDocuments(userId, documents) {
  return {
    method: 'POST',
    user: { id: userId },
    body: { documents },
    get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : '',
  }
}

async function parseRequest(req) {
  return new Promise((resolve) => {
    parseVerificationUpload(req, {}, (error) => resolve(error || null))
  })
}

test('accepts a seller-owned uploaded PDF only after verifying its actual file signature', async () => {
  await withStorageEnvironment(async () => {
    const calls = []
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(Buffer.from('%PDF-1.7 seller document'), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })
    }
    const req = requestWithDocuments(42, {
      identityDocument: validPdfPath,
    })

    const error = await parseRequest(req)

    assert.equal(error, null)
    assert.deepEqual(req.verificationDocuments, { identityDocument: validPdfPath })
    assert.equal(req.verificationDocumentPath, validPdfPath)
    assert.equal(calls.length, 1)
  })
})

test('rejects another seller’s storage key before reading the private object', async () => {
  await withStorageEnvironment(async () => {
    let storageReadAttempted = false
    global.fetch = async () => {
      storageReadAttempted = true
      return new Response(Buffer.from('%PDF-1.7'), { status: 200 })
    }

    const error = await parseRequest(requestWithDocuments(42, {
      identityDocument: 'user_43/123e4567-e89b-42d3-a456-426614174000.pdf',
    }))

    assert.equal(error.statusCode, 403)
    assert.equal(error.message, 'Only your own verification documents can be submitted.')
    assert.equal(storageReadAttempted, false)
  })
})

test('rejects uploaded content whose signature does not match the stored file extension', async () => {
  await withStorageEnvironment(async () => {
    global.fetch = async () => new Response(Buffer.from('<script>alert(1)</script>'), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    })

    const error = await parseRequest(requestWithDocuments(42, {
      identityDocument: validPdfPath,
    }))

    assert.equal(error.statusCode, 400)
    assert.match(error.message, /not an accepted document/)
  })
})

test('accepts WebP documents only when their content signature and MIME type agree', () => {
  const webp = Buffer.from('RIFF0000WEBP')
  assert.doesNotThrow(() => validateDocument(webp, 'user_42/123e4567-e89b-42d3-a456-426614174000.webp', 'image/webp'))
  assert.throws(
    () => validateDocument(webp, 'user_42/123e4567-e89b-42d3-a456-426614174000.png', 'image/png'),
    { statusCode: 400 },
  )
})

test('reports private storage configuration failures as service unavailable errors', async () => {
  const previousEnvironment = new Map(storageVariables.map((key) => [key, process.env[key]]))
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    const error = await parseRequest(requestWithDocuments(42, {
      identityDocument: validPdfPath,
    }))

    assert.equal(error.statusCode, 503)
    assert.match(error.message, /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/)
  } finally {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
