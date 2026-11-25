// Banner images are shown at the same size as the homepage "Sell your solar equipment" section:
// 1200 x 152 px on desktop. Advertisers should supply the same ratio at 2x (2400 x 304 px).
const BANNER_WIDTH = 1200
const BANNER_HEIGHT = 152
const BANNER_RATIO = BANNER_WIDTH / BANNER_HEIGHT
const RATIO_TOLERANCE = 0.04
const MAX_BYTES = 1.5 * 1024 * 1024

function bannerError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function pngSize(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null
  return { type: 'png', contentType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue }
    const marker = buffer[offset + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
    const length = buffer.readUInt16BE(offset + 2)
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isFrame) {
      return { type: 'jpg', contentType: 'image/jpeg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  return null
}

/** Reads type and pixel size from the file bytes (never from the filename or declared type). */
function inspectBannerImage(buffer) {
  return pngSize(buffer) || jpegSize(buffer)
}

/** Returns the image details, or throws a 400 error that tells the advertiser the required size. */
function validateBannerImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw bannerError('Choose a banner image to upload.')
  if (buffer.length > MAX_BYTES) throw bannerError('The banner image must be 1.5 MB or smaller.', 413)
  const image = inspectBannerImage(buffer)
  if (!image) throw bannerError('The banner must be a PNG or JPEG image.')
  if (image.width < BANNER_WIDTH || image.height < 1) {
    throw bannerError(`The banner is too small (${image.width} x ${image.height}). Use ${BANNER_WIDTH * 2} x ${BANNER_HEIGHT * 2} px, or any size with the same shape at least ${BANNER_WIDTH} px wide.`)
  }
  const ratio = image.width / image.height
  if (Math.abs(ratio - BANNER_RATIO) / BANNER_RATIO > RATIO_TOLERANCE) {
    throw bannerError(`The banner is ${image.width} x ${image.height}, which is the wrong shape. Use ${BANNER_WIDTH * 2} x ${BANNER_HEIGHT * 2} px (the same shape as the Sell your solar equipment section).`)
  }
  return image
}

module.exports = { BANNER_HEIGHT, BANNER_WIDTH, MAX_BYTES, inspectBannerImage, validateBannerImage }
