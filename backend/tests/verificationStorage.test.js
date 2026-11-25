const assert = require('node:assert/strict')
const test = require('node:test')
const {
  createVerificationUploadUrls,
  deleteVerificationFiles,
  readVerificationFile,
  uploadVerificationFile,
} = require('../utils/verificationStorage')

const storageVariables = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']

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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

test('creates private, seller-scoped, unique signed upload URLs without using client filenames', async () => {
  await withStorageEnvironment(async () => {
    const calls = []
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), options })
      const requestUrl = new URL(url)
      const objectPath = decodeURIComponent(requestUrl.pathname.split('/object/upload/sign/')[1])
      return jsonResponse({ url: `/object/upload/sign/${objectPath}?token=upload-token` })
    }

    const uploads = await createVerificationUploadUrls(42, [{
      field: 'identityDocument',
      originalName: '../../identity.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    }])

    assert.equal(uploads.length, 1)
    assert.equal(uploads[0].field, 'identityDocument')
    assert.match(uploads[0].path, /^user_42\/[a-f0-9-]{36}\.pdf$/)
    assert.equal(uploads[0].uploadUrl, `https://jimvolt-test.supabase.co/storage/v1/object/upload/sign/seller-verification-private/${uploads[0].path}?token=upload-token`)
    assert.match(calls[0].url, /^https:\/\/jimvolt-test\.supabase\.co\/storage\/v1\/object\/upload\/sign\/seller-verification-private\/user_42\//)
    assert.equal(calls[0].options.headers.authorization, 'Bearer test-service-role-key')
    assert.equal(calls[0].options.headers.apikey, 'test-service-role-key')
    assert.equal(calls[0].options.headers['cache-control'], 'no-store')
  })
})

test('rejects invalid file types and oversized files before requesting a signed URL', async () => {
  await withStorageEnvironment(async () => {
    let requestCount = 0
    global.fetch = async () => {
      requestCount += 1
      return jsonResponse({})
    }

    await assert.rejects(
      createVerificationUploadUrls(42, [{
        field: 'identityDocument',
        originalName: 'payload.svg',
        mimeType: 'image/svg+xml',
        size: 1024,
      }]),
      { statusCode: 415 },
    )
    await assert.rejects(
      createVerificationUploadUrls(42, [{
        field: 'identityDocument',
        originalName: 'large.pdf',
        mimeType: 'application/pdf',
        size: 5 * 1024 * 1024 + 1,
      }]),
      { statusCode: 413 },
    )
    assert.equal(requestCount, 0)
  })
})

test('rejects upload URLs that are not scoped to the requested private object', async () => {
  await withStorageEnvironment(async () => {
    global.fetch = async () => jsonResponse({
      url: 'https://files.example.test/public/document.pdf?token=unexpected',
    })

    await assert.rejects(
      createVerificationUploadUrls(42, [{
        field: 'identityDocument',
        originalName: 'identity.pdf',
        mimeType: 'application/pdf',
        size: 1024,
      }]),
      { statusCode: 502, message: 'Private verification storage returned an unsafe upload URL.' },
    )
  })
})

test('rejects a combined upload request larger than 15 MB before issuing any URLs', async () => {
  await withStorageEnvironment(async () => {
    let requestCount = 0
    global.fetch = async () => {
      requestCount += 1
      return jsonResponse({})
    }

    await assert.rejects(
      createVerificationUploadUrls(42, [
        { field: 'document', originalName: 'one.pdf', mimeType: 'application/pdf', size: 5 * 1024 * 1024 },
        { field: 'cacDocument', originalName: 'two.pdf', mimeType: 'application/pdf', size: 5 * 1024 * 1024 },
        { field: 'identityDocument', originalName: 'three.pdf', mimeType: 'application/pdf', size: 5 * 1024 * 1024 },
        { field: 'additionalDocument', originalName: 'four.pdf', mimeType: 'application/pdf', size: 1 },
      ]),
      { statusCode: 413 },
    )
    assert.equal(requestCount, 0)
  })
})

test('stores legacy multipart uploads under generated private seller-scoped object keys', async () => {
  await withStorageEnvironment(async () => {
    const calls = []
    const document = Buffer.from('%PDF-1.7 legacy upload')
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), options })
      return jsonResponse({ Key: 'seller-verification-private/user_42/document.pdf' })
    }

    const stored = await uploadVerificationFile(42, document, 'application/pdf')

    assert.match(stored.path, /^user_42\/[a-f0-9-]{36}\.pdf$/)
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /\/storage\/v1\/object\/seller-verification-private\/user_42\//)
    assert.equal(calls[0].options.method, 'POST')
    assert.equal(calls[0].options.headers.authorization, 'Bearer test-service-role-key')
    assert.equal(calls[0].options.headers['x-upsert'], 'false')
    assert.deepEqual(Buffer.from(calls[0].options.body), document)
  })
})

test('downloads private verification files through the authenticated storage API', async () => {
  await withStorageEnvironment(async () => {
    const calls = []
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(Buffer.from('%PDF-1.7 private document'), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })
    }

    const file = await readVerificationFile('user_42/123e4567-e89b-42d3-a456-426614174000.pdf')

    assert.equal(file.data.toString(), '%PDF-1.7 private document')
    assert.equal(file.contentType, 'application/pdf')
    assert.match(calls[0].url, /\/storage\/v1\/object\/authenticated\/seller-verification-private\/user_42\//)
    assert.equal(calls[0].options.headers.authorization, 'Bearer test-service-role-key')
    assert.equal(calls[0].options.headers.apikey, 'test-service-role-key')
    assert.equal(calls[0].options.headers['cache-control'], 'no-store')
  })
})

test('deletes only correctly scoped objects belonging to the requested seller', async () => {
  await withStorageEnvironment(async () => {
    const calls = []
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), options })
      return jsonResponse({})
    }

    await deleteVerificationFiles([
      'user_42/123e4567-e89b-42d3-a456-426614174000.pdf',
      'user_43/123e4567-e89b-42d3-a456-426614174001.pdf',
      '../user_42/not-a-document',
    ], 42)

    assert.equal(calls.length, 1)
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      prefixes: ['user_42/123e4567-e89b-42d3-a456-426614174000.pdf'],
    })
  })
})
