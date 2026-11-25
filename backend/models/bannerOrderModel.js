const { pool } = require('../config/database')

const MIN_DAYS = 1
const MAX_DAYS = 90
const PRICE_KEY = 'banner_price_per_day'
const DEFAULT_PRICE_PER_DAY = '5000.00'

function makeError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

// Money is handled in kobo (BigInt) so day counts multiply exactly.
function toKobo(value) {
  const text = String(value)
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}

function fromKobo(kobo) {
  const value = BigInt(kobo)
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`
}

/** Total price for a number of days: more days, more pay. Returns a "1234.00" string. */
function totalFor(days, pricePerDay) {
  const perDay = toKobo(pricePerDay)
  if (perDay === null || !Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    throw makeError(`Choose between ${MIN_DAYS} and ${MAX_DAYS} days.`)
  }
  return fromKobo(perDay * BigInt(days))
}

async function getPricePerDay() {
  const [rows] = await pool.execute('SELECT value FROM app_settings WHERE key = ?', [PRICE_KEY])
  const stored = rows[0]?.value
  if (stored && toKobo(stored) !== null) return stored
  const fromEnv = process.env.BANNER_PRICE_PER_DAY
  return fromEnv && toKobo(fromEnv) !== null ? fromEnv : DEFAULT_PRICE_PER_DAY
}

async function setPricePerDay(value) {
  const kobo = toKobo(value)
  if (kobo === null || kobo < 100n || kobo > 100000000n * 100n) {
    throw makeError('Enter a price per day between 1 and 100,000,000 naira, with up to two decimals.')
  }
  const normalized = fromKobo(kobo)
  await pool.execute(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    [PRICE_KEY, normalized],
  )
  return normalized
}

/** Creates the unpaid banner and its pending payment together. */
async function createOrder({ userId, title, linkUrl, altText, image, days, reference, amount }) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [payment] = await connection.execute(
      `INSERT INTO payment_transactions
       (user_id, payment_type, amount, currency, status, provider, provider_reference, provider_checkout_id)
       VALUES (?, 'banner', ?, 'NGN', 'pending', 'paystack', ?, ?)`,
      [userId, amount, reference, reference],
    )
    const [banner] = await connection.execute(
      `INSERT INTO banners (title, link_url, alt_text, image_data, content_type, width, height,
                            sort_order, is_active, owner_user_id, status, duration_days, payment_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, TRUE, ?, 'pending_payment', ?, ?)`,
      [title, linkUrl, altText, image.data, image.contentType, image.width, image.height,
        userId, days, payment.insertId],
    )
    await connection.commit()
    return { bannerId: banner.insertId, paymentId: payment.insertId }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function getOrderByReference(reference, userId = null) {
  const [rows] = await pool.execute(
    `SELECT b.id AS banner_id, b.status AS banner_status, b.duration_days, b.title,
            p.id AS payment_id, p.user_id, p.amount, p.currency, p.status AS payment_status,
            p.provider_reference, p.provider_checkout_id
     FROM payment_transactions p
     JOIN banners b ON b.payment_id = p.id
     WHERE p.provider = 'paystack' AND p.provider_reference = ? AND p.payment_type = 'banner'
       ${userId === null ? '' : 'AND p.user_id = ?'}
     LIMIT 1`,
    userId === null ? [reference] : [reference, userId],
  )
  return rows[0] || null
}

function checkoutMatches(order, checkout) {
  const expected = toKobo(order.amount)
  const actual = toKobo(checkout.amount)
  return checkout.reference === order.provider_reference
    && checkout.checkout_id === order.provider_checkout_id
    && checkout.payment_status === 'paid'
    && checkout.currency === order.currency
    && expected !== null && actual !== null && expected === actual
}

/**
 * Marks the payment as succeeded after Paystack confirms it, and moves the banner to review.
 * Safe to call more than once (the verify page and the webhook both do).
 */
async function completePayment(reference, checkout) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute(
      `SELECT p.id AS payment_id, p.amount, p.currency, p.status AS payment_status,
              p.provider_reference, p.provider_checkout_id, b.id AS banner_id, b.status AS banner_status
       FROM payment_transactions p JOIN banners b ON b.payment_id = p.id
       WHERE p.provider = 'paystack' AND p.provider_reference = ? AND p.payment_type = 'banner'
       FOR UPDATE OF p, b`,
      [reference],
    )
    if (!rows.length) throw makeError('Payment reference not found.', 404)
    const order = rows[0]
    if (!checkoutMatches(order, checkout)) throw makeError('Payment verification details do not match this order.', 400)
    if (order.payment_status === 'succeeded') {
      await connection.commit()
      return { alreadyProcessed: true, bannerId: order.banner_id, status: order.banner_status }
    }
    if (!['pending', 'failed'].includes(order.payment_status)) {
      throw makeError('This payment is no longer available for verification.', 409)
    }
    await connection.execute(
      `UPDATE payment_transactions SET status = 'succeeded', verified_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [order.payment_id],
    )
    await connection.execute(
      `UPDATE banners SET status = 'pending_review', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending_payment'`,
      [order.banner_id],
    )
    await connection.commit()
    return { alreadyProcessed: false, bannerId: order.banner_id, status: 'pending_review' }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

/** A failed or abandoned checkout: the banner never ran, so it is cancelled. */
async function failOrder(reference) {
  await pool.execute(
    `UPDATE payment_transactions SET status = 'failed'
     WHERE provider = 'paystack' AND provider_reference = ? AND payment_type = 'banner' AND status = 'pending'`,
    [reference],
  )
  await pool.execute(
    `UPDATE banners SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'pending_payment'
       AND payment_id = (SELECT id FROM payment_transactions WHERE provider = 'paystack' AND provider_reference = ?)`,
    [reference],
  )
}

async function listMine(userId) {
  const [rows] = await pool.execute(
    `SELECT b.id, b.title, b.link_url, b.status, b.duration_days, b.starts_at, b.ends_at, b.review_note,
            b.created_at, p.amount AS paid_amount, p.status AS payment_status,
            (b.status = 'active' AND b.ends_at IS NOT NULL AND b.ends_at <= CURRENT_TIMESTAMP) AS is_expired,
            (b.status = 'active' AND (b.starts_at IS NULL OR b.starts_at <= CURRENT_TIMESTAMP)
              AND (b.ends_at IS NULL OR b.ends_at > CURRENT_TIMESTAMP)) AS is_live
     FROM banners b LEFT JOIN payment_transactions p ON p.id = b.payment_id
     WHERE b.owner_user_id = ? AND b.status <> 'cancelled'
     ORDER BY b.created_at DESC LIMIT 50`,
    [userId],
  )
  return rows
}

/** Admin approval starts the clock: the banner runs for its paid days from now. */
async function approve(id) {
  const [result] = await pool.execute(
    `UPDATE banners
     SET status = 'active', is_active = TRUE, review_note = NULL,
         starts_at = CURRENT_TIMESTAMP,
         ends_at = CURRENT_TIMESTAMP + (COALESCE(duration_days, 7) * INTERVAL '1 day'),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'pending_review'`,
    [id],
  )
  return result.affectedRows > 0
}

async function reject(id, note) {
  const [result] = await pool.execute(
    `UPDATE banners SET status = 'rejected', is_active = FALSE, review_note = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'pending_review'`,
    [note, id],
  )
  return result.affectedRows > 0
}

module.exports = {
  MAX_DAYS, MIN_DAYS, approve, completePayment, createOrder, failOrder, getOrderByReference,
  getPricePerDay, listMine, reject, setPricePerDay, totalFor,
}
