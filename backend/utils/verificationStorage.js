const { randomUUID } = require('node:crypto')

const verificationBucket = 'seller-verification-private'
const maximumFileSize = 5 * 1024 * 1024
const maximumSubmissionSize = 15 * 1024 * 1024
const acceptedFields = new Set(['document', 'cacDocument', 'identityDocument', 'additionalDocument'])
const mimeExtensions = new Map([
  ['application/pdf', 'pdf'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
  ['image/heic-sequence', 'heic'],
  ['image/heif-sequence', 'heif'],
])
const verificationObjectPath = /^user_([1-9]\d*)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(pdf|png|jpg|webp|heic|heif)$/i

function storageError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function getSellerId(value) {
  const sellerId = String(value ?? '')
  if (!/^[1-9]\d*$/.test(sellerId)) {
    throw storageError('A valid seller is required to store verification documents.', 400)
  }
  return sellerId
}

function getStorageConfig() {
  const storageUrl = process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!storageUrl || !serviceRoleKey) {
    throw storageError(
      'Private verification storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      503,
    )
  }

  let baseUrl
  try {
    baseUrl = new URL(storageUrl)
  } catch {
    throw storageError('Private verification storage has an invalid SUPABASE_URL configuration.', 503)
  }
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw storageError('Private verification storage has an invalid SUPABASE_URL configuration.', 503)
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, '')
  return { baseUrl, serviceRoleKey }
}

function storageHeaders(serviceRoleKey, contentType) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'cache-control': 'no-store',
    ...(contentType ? { 'content-type': contentType } : {}),
  }
}

function isOwnedVerificationPath(filePath, sellerId) {
  if (typeof filePath !== 'string') return false
  const match = filePath.match(verificationObjectPath)
  return Boolean(match && match[1] === String(sellerId))
}

function isVerificationPath(filePath) {
  return typeof filePath === 'string' && verificationObjectPath.test(filePath)
}

function objectUrl(baseUrl, access, filePath) {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
  const accessPath = access ? `${access}/` : ''
  return new URL(`/storage/v1/object/${accessPath}${verificationBucket}/${encodedPath}`, baseUrl)
}

async function createVerificationUploadUrls(sellerIdValue, requestedFiles) {
  const sellerId = getSellerId(sellerIdValue)
  if (!Array.isArray(requestedFiles) || requestedFiles.length < 1 || requestedFiles.length > acceptedFields.size) {
    throw storageError('Choose between one and four verification documents to upload.', 400)
  }
  const seenFields = new Set()
  let totalSize = 0
  const validatedFiles = []
  for (const file of requestedFiles) {
    const field = file?.field
    const mimeType = String(file?.mimeType || '').trim().toLowerCase()
    const size = Number(file?.size)
    const extension = mimeExtensions.get(mimeType)
    if (!acceptedFields.has(field) || seenFields.has(field)) {
      throw storageError('Choose one supported file for each verification document field.', 400)
    }
    if (!extension) {
      throw storageError('Upload a genuine PDF, PNG, JPEG, WebP or iPhone HEIC photo.', 415)
    }
    if (!Number.isSafeInteger(size) || size < 1) {
      throw storageError('Choose a non-empty verification document.', 400)
    }
    if (size > maximumFileSize) {
      throw storageError('Verification documents must be 5 MB or smaller.', 413)
    }
    totalSize += size
    if (totalSize > maximumSubmissionSize) {
      throw storageError('Combined verification documents must be 15 MB or smaller.', 413)
    }
    seenFields.add(field)
    validatedFiles.push({ field, mimeType, extension })
  }

  const { baseUrl, serviceRoleKey } = getStorageConfig()
  const uploadUrls = []

  for (const { field, mimeType, extension } of validatedFiles) {
    const filePath = `user_${sellerId}/${randomUUID()}.${extension}`
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
    const signedEndpoint = new URL(
      `/storage/v1/object/upload/sign/${verificationBucket}/${encodedPath}`,
      baseUrl,
    )
    let response
    try {
      response = await fetch(signedEndpoint, {
        method: 'POST',
        headers: storageHeaders(serviceRoleKey, 'application/json'),
        body: JSON.stringify({}),
        redirect: 'error',
      })
    } catch {
      throw storageError('Private verification storage could not be reached. Please try again.', 502)
    }
    if (!response.ok) {
      throw storageError('Private verification storage could not prepare the document upload.', 502)
    }

    let result
    try {
      result = await response.json()
    } catch {
      throw storageError('Private verification storage returned an invalid upload response.', 502)
    }
    if (!result || typeof result !== 'object') {
      throw storageError('Private verification storage returned an invalid upload response.', 502)
    }
    const signedUrl = result.signedURL || result.signedUrl || result.url
    if (typeof signedUrl !== 'string') {
      throw storageError('Private verification storage returned an invalid upload response.', 502)
    }

    let uploadUrl
    try {
      uploadUrl = new URL(
        signedUrl.startsWith('/object/')
          ? `/storage/v1${signedUrl}`
          : signedUrl,
        baseUrl,
      )
    } catch {
      throw storageError('Private verification storage returned an invalid upload response.', 502)
    }
    if (
      uploadUrl.origin !== baseUrl.origin
      || uploadUrl.username
      || uploadUrl.password
      || uploadUrl.hash
      || uploadUrl.pathname !== signedEndpoint.pathname
      || !uploadUrl.searchParams.get('token')
    ) {
      throw storageError('Private verification storage returned an unsafe upload URL.', 502)
    }
    uploadUrls.push({ field, path: filePath, uploadUrl: uploadUrl.toString(), mimeType })
  }

  return uploadUrls
}

async function uploadVerificationFile(sellerIdValue, fileData, mimeType) {
  const sellerId = getSellerId(sellerIdValue)
  const extension = mimeExtensions.get(String(mimeType || '').trim().toLowerCase())
  if (!extension) throw storageError('Upload a genuine PDF, PNG, JPEG, WebP or iPhone HEIC photo.', 415)
  if (!Buffer.isBuffer(fileData) || fileData.length < 1) {
    throw storageError('Choose a non-empty verification document.', 400)
  }
  if (fileData.length > maximumFileSize) {
    throw storageError('Verification documents must be 5 MB or smaller.', 413)
  }

  const filePath = `user_${sellerId}/${randomUUID()}.${extension}`
  const { baseUrl, serviceRoleKey } = getStorageConfig()
  let response
  try {
    response = await fetch(objectUrl(baseUrl, '', filePath), {
      method: 'POST',
      headers: {
        ...storageHeaders(serviceRoleKey, mimeType),
        'x-upsert': 'false',
      },
      body: fileData,
      redirect: 'error',
    })
  } catch {
    throw storageError('Private verification storage could not be reached. Please try again.', 502)
  }
  if (!response.ok) {
    throw storageError('Private verification storage could not store the document.', 502)
  }
  return { path: filePath }
}

async function readVerificationFile(filePath) {
  if (!isVerificationPath(filePath)) {
    throw storageError('Verification document not found.', 404)
  }
  const { baseUrl, serviceRoleKey } = getStorageConfig()
  let response
  try {
    response = await fetch(objectUrl(baseUrl, 'authenticated', filePath), {
      headers: storageHeaders(serviceRoleKey),
      redirect: 'error',
    })
  } catch {
    throw storageError('Private verification storage could not be reached. Please try again.', 502)
  }
  if (response.status === 404) throw storageError('Verification document not found.', 404)
  if (!response.ok) {
    throw storageError('Private verification storage could not retrieve the document.', 502)
  }

  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximumFileSize) {
    throw storageError('Verification document exceeds the 5 MB limit.', 413)
  }
  let data
  try {
    data = Buffer.from(await response.arrayBuffer())
  } catch {
    throw storageError('Private verification storage returned an incomplete document.', 502)
  }
  if (!data.length) throw storageError('Verification document is empty.', 422)
  if (data.length > maximumFileSize) throw storageError('Verification document exceeds the 5 MB limit.', 413)
  return {
    data,
    contentType: response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || 'application/octet-stream',
  }
}

async function deleteVerificationFiles(filePaths, sellerIdValue) {
  const sellerId = getSellerId(sellerIdValue)
  const prefixes = [...new Set((filePaths || []).filter((filePath) => isOwnedVerificationPath(filePath, sellerId)))]
  if (!prefixes.length) return

  const { baseUrl, serviceRoleKey } = getStorageConfig()
  let response
  try {
    response = await fetch(new URL(`/storage/v1/object/${verificationBucket}`, baseUrl), {
      method: 'DELETE',
      headers: storageHeaders(serviceRoleKey, 'application/json'),
      body: JSON.stringify({ prefixes }),
      redirect: 'error',
    })
  } catch {
    throw storageError('Private verification storage could not be reached to remove an unused upload.', 502)
  }
  if (!response.ok) {
    throw storageError('Private verification storage could not remove an unused upload.', 502)
  }
}

module.exports = {
  acceptedVerificationFields: acceptedFields,
  createVerificationUploadUrls,
  deleteVerificationFiles,
  isOwnedVerificationPath,
  isVerificationPath,
  maximumVerificationFileSize: maximumFileSize,
  maximumVerificationSubmissionSize: maximumSubmissionSize,
  readVerificationFile,
  uploadVerificationFile,
  verificationBucket,
}
