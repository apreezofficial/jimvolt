const { heicMimeTypes, isHeic, convertHeicToJpeg } = require('../utils/heic')
const { deleteVerificationFiles, saveVerificationFile } = require('../utils/verificationStorage')

const maximumSize = 5 * 1024 * 1024
const maximumRequestSize = 15 * 1024 * 1024
const acceptedFields = new Set(['document', 'cacDocument', 'identityDocument', 'additionalDocument'])

function uploadError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function detectDocumentType(buffer) {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'pdf'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg'
  if (isHeic(buffer)) return 'heic'
  return null
}

async function parseVerificationUpload(req, res, next) {
  try {
    const contentType = req.get('content-type') || ''
    const boundary = contentType.match(/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i)
    if (!boundary) throw uploadError('Upload a supporting document as multipart form data.')

    const delimiter = Buffer.from(`--${boundary[1] || boundary[2]}`)
    const chunks = []
    let total = 0
    for await (const chunk of req) {
      total += chunk.length
      if (total > maximumRequestSize + 32768) throw uploadError('Combined verification documents must be 15 MB or smaller.', 413)
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
        if (!acceptedFields.has(name) || !filename) throw uploadError('Choose a supported verification document.')
        if (data.length > maximumSize) throw uploadError(`"${filename}" is larger than 5 MB. Choose a smaller file.`, 413)
        const declaredType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase()
        let extension = detectDocumentType(data)
        let fileData = data
        const expectedTypes = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' }
        const declaredHeic = heicMimeTypes.has(declaredType) || ['', 'application/octet-stream'].includes(declaredType || '')
        if (!extension || (extension === 'heic' ? !declaredHeic : declaredType !== expectedTypes[extension])) {
          throw uploadError(`"${filename}" is not an accepted document. Upload a genuine PDF, PNG, JPEG or iPhone HEIC photo.`)
        }
        if (extension === 'heic') {
          fileData = await convertHeicToJpeg(data)
          extension = 'jpg'
          if (fileData.length > maximumSize) throw uploadError('Verification documents must be 5 MB or smaller after conversion. Choose a smaller photo.', 413)
        }
        if (parts.some((part) => part.name === name)) throw uploadError('Only one file may be uploaded in each document field.')
        parts.push({ name, filename, data: fileData, extension })
      } else if (name) {
        req.body[name] = data.toString('utf8')
      }
      cursor = next
    }
    if (!parts.length && req.method !== 'PUT') {
      throw uploadError('Attach at least one supporting verification document.')
    }

    const storedFiles = {}
    try {
      for (const part of parts) {
        storedFiles[part.name] = await saveVerificationFile(part.data, part.extension)
      }
    } catch (error) {
      await deleteVerificationFiles(Object.values(storedFiles))
      throw error
    }
    req.verificationDocuments = storedFiles
    req.verificationDocumentPath = storedFiles.document || storedFiles.identityDocument || Object.values(storedFiles)[0]
    next()
  } catch (error) {
    next(error)
  }
}

module.exports = { parseVerificationUpload }
