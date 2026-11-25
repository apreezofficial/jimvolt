// Small translation layer so the models, which were written for mysql2, run on PostgreSQL.
// It handles only mechanical differences. Anything that needs real SQL changes (dates, upserts,
// full-text search) is written in PostgreSQL directly in the models.

// Tables that have a single generated `id` column. INSERTs into them return it as `insertId`.
const TABLES_WITH_ID = new Set([
  'users', 'categories', 'advertisements', 'product_images', 'favourites', 'recently_viewed',
  'price_history', 'conversations', 'messages', 'seller_profiles', 'seller_slug_history',
  'seller_verifications', 'advertisement_analytics', 'notifications', 'admin_audit_logs',
  'reports', 'payment_transactions', 'promotion_packages', 'promotions', 'banners',
])

// `?` -> `$1, $2, ...` and `backticks` -> "double quotes", leaving quoted string literals alone.
function convertSyntax(sql) {
  let output = ''
  let index = 0
  let quote = null
  for (let position = 0; position < sql.length; position += 1) {
    const character = sql[position]
    if (quote) {
      output += character
      if (character === quote) {
        if (sql[position + 1] === quote) {
          output += sql[position + 1]
          position += 1
        } else {
          quote = null
        }
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      output += character
    } else if (character === '`') {
      output += '"'
    } else if (character === '?') {
      index += 1
      output += `$${index}`
    } else {
      output += character
    }
  }
  return output
}

function toPostgres(sql) {
  let text = String(sql).trim().replace(/;$/, '')
  const insertIgnore = /^INSERT\s+IGNORE\s+INTO\b/i.test(text)
  if (insertIgnore) text = text.replace(/^INSERT\s+IGNORE\s+INTO\b/i, 'INSERT INTO')

  const insert = /^INSERT\s+INTO\s+["`]?(\w+)/i.exec(text)
  const isWrite = /^(INSERT|UPDATE|DELETE)\b/i.test(text)
  const hasReturning = /\bRETURNING\b/i.test(text)

  if (insertIgnore) text += ' ON CONFLICT DO NOTHING'
  const returnsId = Boolean(insert && TABLES_WITH_ID.has(insert[1].toLowerCase()) && !hasReturning)
  if (returnsId) text += ' RETURNING id'

  return { text: convertSyntax(text), returnsId, isWrite: isWrite && !hasReturning }
}

// Give results the mysql2 shape: `[rows, fields]` for reads, `[{ insertId, affectedRows }]` for writes.
function shapeResult(result, translated) {
  if (translated.returnsId) {
    return [{
      insertId: result.rows[0]?.id ?? 0,
      affectedRows: result.rowCount,
      changedRows: result.rowCount,
    }, []]
  }
  if (translated.isWrite) {
    return [{ insertId: 0, affectedRows: result.rowCount, changedRows: result.rowCount }, []]
  }
  return [result.rows, result.fields]
}

// Keep the error codes the rest of the application already checks for.
const ERROR_CODES = {
  23505: 'ER_DUP_ENTRY',
  23503: 'ER_NO_REFERENCED_ROW_2',
  23514: 'ER_CHECK_CONSTRAINT_VIOLATED',
  28000: 'ER_ACCESS_DENIED_ERROR',
  '28P01': 'ER_ACCESS_DENIED_ERROR',
  '3D000': 'ER_BAD_DB_ERROR',
  53300: 'ER_CON_COUNT_ERROR',
  '40P01': 'ER_LOCK_DEADLOCK',
}

function mapPostgresError(error, sql) {
  if (sql && error && !error.sql) error.sql = sql
  const mapped = ERROR_CODES[error?.code]
  if (mapped) {
    error.postgresCode = error.code
    error.code = mapped
  }
  return error
}

module.exports = { toPostgres, shapeResult, mapPostgresError, convertSyntax, TABLES_WITH_ID }
