const multer = require('multer')
const { MAX_BYTES } = require('../utils/bannerImage')

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 12, fieldSize: 4096 },
}).single('image')

// Parses one optional "image" file plus the text fields into req.file / req.body.
function bannerImageUpload(req, res, next) {
  parser(req, res, (error) => {
    if (!error) return next()
    if (error.code === 'LIMIT_FILE_SIZE') error.message = 'The banner image must be 1.5 MB or smaller.'
    else if (error.code === 'LIMIT_UNEXPECTED_FILE') error.message = 'Upload the banner in the "image" field.'
    error.statusCode = error.statusCode || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
    return next(error)
  })
}

module.exports = bannerImageUpload
