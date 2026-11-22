const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { Pool, types } = require('pg')
const { withSchemaLock } = require('../utils/schemaLock')
const { toPostgres, shapeResult, mapPostgresError } = require('../utils/sqlAdapter')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

const requiredVariables = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']
const missingVariables = requiredVariables.filter((name) => process.env[name] === undefined)
if (missingVariables.length) {
  throw new Error(`Missing database configuration: ${missingVariables.join(', ')}`)
}
if (!process.env.DB_NAME) {
  throw new Error('DB_NAME must be configured.')
}
if (['root', 'postgres'].includes(process.env.DB_USER.toLowerCase())) {
  throw new Error('Configure DB_USER with a dedicated Jimvolt application account, not a superuser such as root or postgres.')
}

const isLocalDatabase = ['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST.toLowerCase())
const sslCaSetting = process.env.DB_SSL_CA?.trim()
// DB_SSL_MODE=require encrypts the connection without checking the server certificate. Prefer DB_SSL_CA
// (your provider's CA certificate, e.g. Supabase's prod-ca-2021.crt or Aiven's ca.pem) whenever possible.
const sslRequireOnly = String(process.env.DB_SSL_MODE || '').trim().toLowerCase() === 'require'
if (!isLocalDatabase && !sslCaSetting && !sslRequireOnly) {
  throw new Error('Set DB_SSL_CA to your database provider\'s CA certificate path (or DB_SSL_MODE=require) when using a remote PostgreSQL database.')
}

let ssl
if (sslCaSetting) {
  const sslCaPath = path.resolve(__dirname, '..', sslCaSetting)
  try {
    ssl = {
      ca: fsSync.readFileSync(sslCaPath, 'utf8'),
      rejectUnauthorized: true,
    }
  } catch (error) {
    throw new Error(`Could not read the configured DB_SSL_CA certificate at ${sslCaPath}: ${error.message}`)
  }
} else if (sslRequireOnly && !isLocalDatabase) {
  console.warn('DB_SSL_MODE=require: the database connection is encrypted but the server certificate is not verified.')
  ssl = { rejectUnauthorized: false }
}

// Return BIGINT/COUNT values as numbers (as the MySQL driver did). NUMERIC stays a string, which
// keeps money values exact exactly like MySQL DECIMAL did.
types.setTypeParser(20, (value) => Number(value))

// Every Vercel instance gets its own pool, so keep serverless pools tiny. On Vercel use your provider's
// connection pooler: Supabase's pooler in transaction mode (port 6543) or Aiven's PgBouncer pool port.
// Queries use unnamed statements and transaction-scoped locks, so transaction pooling is safe.
const isServerless = process.env.VERCEL === '1'
const connectionLimit = Number.parseInt(process.env.DB_CONNECTION_LIMIT, 10) || (isServerless ? 2 : 10)

const rawPool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 5432),
  max: connectionLimit,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 10000,
  keepAlive: true,
  allowExitOnIdle: true,
  ...(ssl ? { ssl } : {}),
})
rawPool.on('error', (error) => console.error('Idle PostgreSQL client error:', error.message))

// A connection wrapper that keeps the call style the models were written for:
// `const [rows] = await connection.execute(sql, params)` and `beginTransaction()` / `commit()`.
function wrapClient(client) {
  const run = async (sql, params = []) => {
    const translated = toPostgres(sql)
    try {
      const result = await client.query(translated.text, params)
      return shapeResult(result, translated)
    } catch (error) {
      throw mapPostgresError(error, translated.text)
    }
  }
  return {
    query: run,
    execute: run,
    // Sends SQL untouched (multi-statement scripts such as the schema file).
    raw: (sql) => client.query(sql),
    beginTransaction: () => client.query('BEGIN'),
    commit: () => client.query('COMMIT'),
    rollback: () => client.query('ROLLBACK'),
    release: () => client.release(),
    destroy: () => client.release(true),
  }
}

const pool = {
  query: (sql, params) => run(sql, params),
  execute: (sql, params) => run(sql, params),
  async getConnection() {
    return wrapClient(await rawPool.connect())
  },
  end: () => rawPool.end(),
  raw: rawPool,
}

async function run(sql, params = []) {
  const translated = toPostgres(sql)
  try {
    return shapeResult(await rawPool.query(translated.text, params), translated)
  } catch (error) {
    throw mapPostgresError(error, translated.text)
  }
}

async function connectDB() {
  const connection = await pool.getConnection()
  try {
    const [rows] = await connection.query('SELECT current_database() AS database_name')
    if (rows[0].database_name !== process.env.DB_NAME) {
      throw new Error('Connected to an unexpected PostgreSQL database.')
    }
    console.log(`PostgreSQL connected: ${rows[0].database_name}`)
  } finally {
    connection.release()
  }
}

async function ensureCoreSchema() {
  try {
    return await withSchemaLock(pool, process.env.DB_NAME, initializeCoreSchema)
  } catch (error) {
    // Another instance is already initializing the schema; it will finish without us.
    if (error.code === 'SCHEMA_BUSY') {
      console.warn('Schema initialization is running on another instance; continuing.')
      return undefined
    }
    throw error
  }
}

async function initializeCoreSchema(connection) {
  const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8')
  if (!/CREATE TABLE IF NOT EXISTS\s+/i.test(schema)) {
    throw new Error('No safe CREATE TABLE IF NOT EXISTS statements found in config/schema.sql.')
  }

  // Skip the whole run when this exact schema file was already applied. Re-running DDL on every
  // cold start would take table locks and slow every serverless instance start.
  const hash = createHash('sha256').update(schema).digest('hex')
  await connection.query(
    'CREATE TABLE IF NOT EXISTS schema_state (id SMALLINT PRIMARY KEY, schema_hash TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  )
  const [state] = await connection.query('SELECT schema_hash FROM schema_state WHERE id = 1')
  if (state[0]?.schema_hash === hash) return

  // The schema file is plain, idempotent SQL; send it as one multi-statement script.
  await connection.raw(schema)

  const defaultPackages = [
    ['Boost', 'A short campaign to give an approved listing extra visibility.', 2000, 3, 'Featured placement for 3 days'],
    ['Featured', 'A week of sponsored visibility for an approved listing.', 5000, 7, 'Featured placement for 7 days'],
    ['Premium', 'Two weeks of premium marketplace visibility.', 9000, 14, 'Featured placement for 14 days'],
    ['Premium Plus', 'A full month of premium marketplace visibility.', 15000, 30, 'Featured placement for 30 days'],
  ]
  for (const [name, description, price, durationDays, benefits] of defaultPackages) {
    const [equivalentPackages] = await connection.execute(
      `SELECT id FROM promotion_packages
       WHERE price = ? AND duration_days = ? AND is_active = TRUE LIMIT 1`,
      [price, durationDays],
    )
    if (!equivalentPackages.length) {
      await connection.execute(
        `INSERT IGNORE INTO promotion_packages (name, description, price, duration_days, benefits)
         VALUES (?, ?, ?, ?, ?)`,
        [name, description, price, durationDays, benefits],
      )
    }
  }

  await connection.execute(
    `INSERT INTO schema_state (id, schema_hash) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET schema_hash = EXCLUDED.schema_hash, applied_at = CURRENT_TIMESTAMP`,
    [hash],
  )
}

module.exports = { pool, connectDB, ensureCoreSchema }
