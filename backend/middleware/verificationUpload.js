const { heicMimeTypes, isHeic, convertHeicToJpeg } = require('../utils/heic')
const { deleteVerificationFiles, saveVerificationFile } = require('../utils/verificationStorage')


function uploadError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function detectDocumentType(buffer) {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'pdf'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp'
  if (isHeic(buffer)) return 'heic'
  return null
}

function validateDocument(data, filePath, contentType) {
  const extension = filePath.split('.').pop().toLowerCase()
  const actualType = detectDocumentType(data)
  const acceptedExtensions = extension === 'heif' ? ['heic', 'heif'] : [extension]
  const expectedMime = {
    pdf: ['application/pdf'],
    png: ['image/png'],
    jpg: ['image/jpeg'],
    webp: ['image/webp'],
    heic: [...heicMimeTypes, 'application/octet-stream'],
    heif: [...heicMimeTypes, 'application/octet-stream'],
  }[extension]
  const declaredType = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (
    !actualType
    || !acceptedExtensions.includes(actualType)
    || !expectedMime?.includes(declaredType)
  ) {
    throw uploadError('This is not an accepted document. Upload a genuine PDF, PNG, JPEG, WebP or iPhone HEIC photo.')
  }
}

async function parseStoredDocumentKeys(req) {
  const documents = req.body?.documents
  if (!documents || typeof documents !== 'object' || Array.isArray(documents)) {
    throw uploadError('Attach at least one supporting verification document.')
  }

  const entries = Object.entries(documents)
  if (entries.length > acceptedVerificationFields.size) {
    throw uploadError('Choose no more than four verification documents.')
  }
  const verifiedDocuments = {}
  req.verificationDocuments = verifiedDocuments
  let totalSize = 0
  for (const [field, filePath] of entries) {
    if (!acceptedVerificationFields.has(field) || typeof filePath !== 'string') {
      throw uploadError('Choose a supported verification document.')
    }
    if (!isOwnedVerificationPath(filePath, req.user?.id)) {
      throw uploadError('Only your own verification documents can be submitted.', 403)
    }
    verifiedDocuments[field] = filePath
    const file = await readVerificationFile(filePath)
    totalSize += file.data.length
    if (totalSize > maximumVerificationSubmissionSize) {
      throw uploadError('Combined verification documents must be 15 MB or smaller.', 413)
    }
    validateDocument(file.data, filePath, file.contentType)
  }

  req.verificationDocumentPath = verifiedDocuments.document
    || verifiedDocuments.identityDocument
    || Object.values(verifiedDocuments)[0]
}

async function parseLegacyMultipart(req) {
  const contentType = req.get('content-type') || ''
  const boundary = contentType.match(/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i)
  if (!boundary) throw uploadError('Submit verification details as JSON with private document paths.')

  const delimiter = Buffer.from(`--${boundary[1] || boundary[2]}`)
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maximumRequestSize) {
      throw uploadError('Use private document uploads for files larger than the 4 MB multipart request limit.', 413)
    }
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks)
  req.body ||= {}
  const parts = []
  let cursor = body.indexOf(delimiter)
  while (cursor !== -1) {
    cursor += delimiter.length
    if (body.subarray(cursor, cursor + 2).toString() === '--') break
    if (body.subarray(cursor, cursor + 2).toString() === '\r\n') cursor += 2
    const next = body.indexOf(delimiter, cursor)
    if (next === -1) throw uploadError('The uploaded form is malformed.')
    let end = next
    if (body.subarray(end - 2, end).toString() === '\r\n') end -= 2
    const part = body.subarray(cursor, end)
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd < 0) throw uploadError('The uploaded form is malformed.')
    const headers = part.subarray(0, headerEnd).toString('utf8')
    const data = part.subarray(headerEnd + 4)
    const disposition = headers.match(/content-disposition:\s*form-data;([^]*)/i)?.[1] || ''
    const name = disposition.match(/(?:^|;)\s*name="([^"]+)"/i)?.[1]
    const filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1]
    if (filename !== undefined) {
      if (!acceptedVerificationFields.has(name) || !filename) {
        throw uploadError('Choose a supported verification document.')
      }
      if (data.length > maximumVerificationFileSize) {
        throw uploadError(`"${filename}" is larger than 5 MB. Choose a smaller file.`, 413)
      }
      const declaredType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase()
      let extension = detectDocumentType(data)
      let fileData = data
      const expectedTypes = {
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        webp: 'image/webp',
      }
      const declaredHeic = heicMimeTypes.has(declaredType) || ['', 'application/octet-stream'].includes(declaredType || '')
      if (!extension || (extension === 'heic' ? !declaredHeic : declaredType !== expectedTypes[extension])) {
        throw uploadError(`"${filename}" is not an accepted document. Upload a genuine PDF, PNG, JPEG, WebP or iPhone HEIC photo.`)
      }
      if (extension === 'heic') {
        fileData = await convertHeicToJpeg(data)
        extension = 'jpg'
        if (fileData.length > maximumVerificationFileSize) {
          throw uploadError('Verification documents must be 5 MB or smaller after conversion. Choose a smaller photo.', 413)
        }
      }
      if (parts.some((part) => part.name === name)) {
        throw uploadError('Only one file may be uploaded in each document field.')
      }
      parts.push({
        name,
        data: fileData,
        extension,
        mimeType: extension === 'jpg' ? 'image/jpeg' : expectedTypes[extension],
      })
    } else if (name) {
      req.body[name] = data.toString('utf8')
    }
    cursor = next
  }

  if (!parts.length && req.method !== 'PUT') {
    throw uploadError('Attach at least one supporting verification document.')
  }

    }
    next()
  } catch (error) {
    const pendingPaths = Object.values(req.verificationDocuments || {})
    if (pendingPaths.length && error.statusCode !== 503) {
      try {
        await deleteVerificationFiles(pendingPaths, req.user?.id)
      } catch (cleanupError) {
        console.error('Could not remove invalid verification uploads:', cleanupError.message)
      }
    }
    next(error)
  }
}

