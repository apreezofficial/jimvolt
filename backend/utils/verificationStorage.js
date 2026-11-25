const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pool } = require('../config/database')

// Verification documents are private. Serverless hosts such as Vercel have a read-only disk,
// so files are stored in the database (BYTEA). The stored name (uuid.ext) is what the
// *_document_path columns keep, so nothing else in the app depends on where bytes live.
// Files written to disk by older versions are still readable as a fallback.
const legacyDirectory = path.resolve(__dirname, '../private-verifications')
const NAME_PATTERN = /^[0-9a-f-]{36}\.(?:pdf|png|jpg)$/
const CONTENT_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' }

function isValidName(name) {
  return typeof name === 'string' && NAME_PATTERN.test(name)
}

async function saveVerificationFile(data, extension) {
  if (!CONTENT_TYPES[extension]) throw new Error('Unsupported verification document type.')
  const name = `${crypto.randomUUID()}.${extension}`
  await pool.execute(
    'INSERT INTO verification_files (name, content_type, data) VALUES (?, ?, ?)',
    [name, CONTENT_TYPES[extension], data],
  )
  return name
}

async function readVerificationFile(name) {
  if (!isValidName(name)) return null
  const [rows] = await pool.execute('SELECT content_type, data FROM verification_files WHERE name = ? LIMIT 1', [name])
  if (rows[0]) return { contentType: rows[0].content_type, data: rows[0].data }
  try {
    const data = await fs.readFile(path.join(legacyDirectory, name))
    return { contentType: CONTENT_TYPES[name.split('.').pop()], data }
  } catch {
    return null
  }
}

async function deleteVerificationFiles(names) {
  const valid = (names || []).filter(isValidName)
  if (!valid.length) return
  await pool.execute('DELETE FROM verification_files WHERE name = ANY(?::text[])', [valid]).catch(() => {})
  await Promise.all(valid.map((name) => fs.unlink(path.join(legacyDirectory, name)).catch(() => {})))
}

module.exports = { deleteVerificationFiles, isValidName, readVerificationFile, saveVerificationFile }
