const assert = require('node:assert/strict')
const test = require('node:test')
const { inspectBannerImage, validateBannerImage } = require('../utils/bannerImage')

function png(width, height, extra = 0) {
  const header = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'ascii')
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  return Buffer.concat([header, Buffer.alloc(extra)])
}

function jpeg(width, height) {
  // SOI, then an APP0 segment, then a baseline start-of-frame segment carrying the size.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
  const sof = Buffer.alloc(19)
  sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8
  sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7); sof[9] = 3
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof])
}

test('reads the size of PNG and JPEG files from their bytes', () => {
  assert.deepEqual(inspectBannerImage(png(2400, 304)), { type: 'png', contentType: 'image/png', width: 2400, height: 304 })
  assert.deepEqual(inspectBannerImage(jpeg(2400, 304)), { type: 'jpg', contentType: 'image/jpeg', width: 2400, height: 304 })
  assert.equal(inspectBannerImage(Buffer.from('GIF89a......')), null)
})

test('accepts banners with the section shape at 1x, 2x or larger', () => {
  assert.equal(validateBannerImage(png(1200, 152)).width, 1200)
  assert.equal(validateBannerImage(png(2400, 304)).height, 304)
  assert.equal(validateBannerImage(jpeg(3600, 456)).type, 'jpg')
})

test('rejects banners of the wrong shape or too small, telling the advertiser the size to use', () => {
  assert.throws(() => validateBannerImage(png(1200, 600)), /2400 x 304/)
  assert.throws(() => validateBannerImage(png(1000, 126)), /too small/)
  assert.throws(() => validateBannerImage(Buffer.from('not an image at all, just text')), /PNG or JPEG/)
  assert.throws(() => validateBannerImage(Buffer.alloc(0)), /Choose a banner image/)
})

test('rejects banners over 1.5 MB', () => {
  assert.throws(() => validateBannerImage(png(2400, 304, 1.6 * 1024 * 1024)), { statusCode: 413 })
})
