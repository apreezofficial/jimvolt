const fs = require('node:fs/promises')
const path = require('node:path')
const { pool } = require('../config/database')
const { detectDocumentType } = require('../middleware/verificationUpload')
const {
  deleteVerificationFiles,
  isVerificationPath,
  maximumVerificationFileSize,
  uploadVerificationFile,
} = require('../utils/verificationStorage')

const legacyDirectory = path.resolve(__dirname, '../private-verifications')
const documentColumns = [
  ['cac_document_path', 'cac_document_path'],
  ['identity_document_path', 'identity_document_path'],
  ['additional_document_path', 'additional_document_path'],
  ['document_path', 'document_path'],
]
const legacyFileName = /^[0-9a-f-]{36}\.(pdf|png|jpg|webp|heic|heif)$/i
const mimeTypes = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}

function isLegacyFileName(value) {
  return typeof value === 'string' && legacyFileName.test(value)
}

async function loadLegacyDocument(fileName) {
  if (!isLegacyFileName(fileName)) {
    throw new Error('A legacy verification record contains an unsupported local document path.')
  }
  const sourcePath = path.join(legacyDirectory, fileName)
  const metadata = await fs.lstat(sourcePath)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximumVerificationFileSize) {
    throw new Error(`Legacy verification document ${fileName} is not a regular file under 5 MB.`)
  }
  const fileData = await fs.readFile(sourcePath)
  if (!fileData.length || fileData.length > maximumVerificationFileSize) {
    throw new Error(`Legacy verification document ${fileName} is empty or larger than 5 MB.`)
  }
  const extension = fileName.split('.').pop().toLowerCase()
  const actualType = detectDocumentType(fileData)
  if (actualType !== extension && !(extension === 'heif' && actualType === 'heic')) {
    throw new Error(`Legacy verification document ${fileName} does not match its file contents.`)
  }
  return { fileData, mimeType: mimeTypes[extension] }
}

async function migrateVerificationDocuments() {
  if (process.env.VERCEL === '1') {
    throw new Error('Run this one-time migration from a trusted machine with the legacy files available, not on Vercel.')
  }
  const [rows] = await pool.execute(
    `SELECT id, user_id, cac_document_path, identity_document_path,
            additional_document_path, document_path
     FROM seller_verifications
     ORDER BY id`,
  )
  let migratedCount = 0
  let missingCount = 0

  for (const row of rows) {
    const changedPaths = []
    const uploadedPaths = []
    const uploadedByFilename = new Map()
    try {
      for (const [column, property] of documentColumns) {
        const oldPath = row[property]
        if (!oldPath || isVerificationPath(oldPath)) continue
        if (!isLegacyFileName(oldPath)) {
          throw new Error(`Verification ${row.id} has a local document path that cannot be migrated safely.`)
        }

        let nextPath = uploadedByFilename.get(oldPath)
        if (!nextPath) {
          let legacyFile
          try {
            legacyFile = await loadLegacyDocument(oldPath)
          } catch (error) {
            if (error.code !== 'ENOENT') throw error
            missingCount += 1
            console.error(`Legacy verification file is missing for verification ${row.id} (${column}).`)
            continue
          }
          const stored = await uploadVerificationFile(row.user_id, legacyFile.fileData, legacyFile.mimeType)
          nextPath = stored.path
          uploadedByFilename.set(oldPath, nextPath)
          uploadedPaths.push(nextPath)
        }
        changedPaths.push({ column, oldPath, nextPath })
      }

      if (!changedPaths.length) continue
      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        for (const { column, oldPath, nextPath } of changedPaths) {
          const [result] = await connection.execute(
            `UPDATE seller_verifications SET ${column} = ? WHERE id = ? AND ${column} = ?`,
            [nextPath, row.id, oldPath],
          )
          if (result.affectedRows !== 1) {
            throw new Error(`Verification ${row.id} changed during document migration; retry after reviewing the record.`)
          }
        }
        await connection.commit()
        migratedCount += changedPaths.length
      } catch (error) {
        await connection.rollback()
        throw error
      } finally {
        connection.release()
      }
    } catch (error) {
      try {
        await deleteVerificationFiles(uploadedPaths, row.user_id)
      } catch (cleanupError) {
        console.error(`Could not clean up an incomplete migration for verification ${row.id}:`, cleanupError.message)
      }
      throw error
    }
  }

  return { migratedCount, missingCount }
}

if (require.main === module) {
  migrateVerificationDocuments()
    .then(({ migratedCount, missingCount }) => {
      console.log(`Migrated ${migratedCount} verification document references.`)
      if (missingCount) {
        console.error(`${missingCount} legacy verification document reference(s) still need their source files restored.`)
        process.exitCode = 1
      }
    })
    .catch((error) => {
      console.error('Seller verification document migration failed:', error.message)
      process.exitCode = 1
    })
    .finally(() => pool.end())
}

module.exports = { isLegacyFileName, loadLegacyDocument, migrateVerificationDocuments }
