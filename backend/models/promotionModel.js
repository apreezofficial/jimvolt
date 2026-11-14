const { pool } = require('../config/database')

function makeError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function decimalToMinorUnits(value) {
  const amount = String(value)
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)) return null
  const [whole, fraction = ''] = amount.split('.')
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}

function checkoutMatchesPayment(payment, checkout) {
  const expectedAmount = decimalToMinorUnits(payment.amount)
  const actualAmount = decimalToMinorUnits(checkout.amount)
  return checkout.checkout_id === payment.provider_checkout_id
    && checkout.reference === payment.provider_reference
    && checkout.payment_status === 'paid'
    && checkout.currency === payment.currency
    && expectedAmount !== null
    && actualAmount !== null
    && actualAmount === expectedAmount
}

async function listPackages({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE is_active = TRUE' : ''
  const [rows] = await pool.execute(
    `SELECT id, name, description, price, duration_days, benefits, is_active, created_at, updated_at
     FROM promotion_packages ${where} ORDER BY duration_days ASC, id ASC`,
  )
  return rows
}

async function findOwnedAdvertisement(userId, advertisementId) {
  const [rows] = await pool.execute(
    `SELECT id, title, status FROM advertisements WHERE id = ? AND user_id = ? LIMIT 1`,
    [advertisementId, userId],
  )
  return rows[0] || null
}

async function createPendingPromotion({ userId, advertisementId, packageId, reference }) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [packages] = await connection.execute(
      `SELECT id, name, price, duration_days FROM promotion_packages
       WHERE id = ? AND is_active = TRUE FOR UPDATE`,
      [packageId],
    )
    if (!packages.length) throw makeError('This promotion package is no longer available.', 404)

    const [advertisements] = await connection.execute(
      `SELECT id, title, status FROM advertisements
       WHERE id = ? AND user_id = ? FOR UPDATE`,
      [advertisementId, userId],
    )
    if (!advertisements.length) throw makeError('Advertisement not found.', 404)
    const advertisement = advertisements[0]
    if (!['pending', 'approved'].includes(advertisement.status)) {
      throw makeError('Only pending or approved advertisements can be promoted.', 409)
    }

    const [existing] = await connection.execute(
      `SELECT id FROM promotions
       WHERE advertisement_id = ?
         AND (status = 'pending_payment'
           OR (status = 'active' AND expires_at > CURRENT_TIMESTAMP))
       LIMIT 1 FOR UPDATE`,
      [advertisementId],
    )
    if (existing.length) throw makeError('This advertisement already has a pending or active promotion.', 409)

    const packageInfo = packages[0]
    const [payment] = await connection.execute(
      `INSERT INTO payment_transactions
       (user_id, advertisement_id, payment_type, amount, currency, status, provider, provider_reference)
       VALUES (?, ?, 'promotion', ?, 'NGN', 'pending', 'bachs', ?)`,
      [userId, advertisementId, packageInfo.price, reference],
    )
    const [promotion] = await connection.execute(
      `INSERT INTO promotions
       (user_id, advertisement_id, package_id, payment_id, duration_days, status)
       VALUES (?, ?, ?, ?, ?, 'pending_payment')`,
      [userId, advertisementId, packageInfo.id, payment.insertId, packageInfo.duration_days],
    )
    await connection.commit()
    return {
      id: promotion.insertId,
      paymentId: payment.insertId,
      advertisement,
      package: packageInfo,
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function saveCheckoutSession(reference, checkout) {
  const expiresAt = checkout.expires_at
    ? new Date(checkout.expires_at).toISOString().slice(0, 19).replace('T', ' ')
    : null
  const [result] = await pool.execute(
    `UPDATE payment_transactions
     SET provider_checkout_id = ?, provider_session_expires_at = ?
     WHERE provider = 'bachs' AND provider_reference = ? AND status = 'pending'`,
    [checkout.checkout_id, expiresAt, reference],
  )
  if (!result.affectedRows) throw makeError('The promotion checkout could not be saved.', 500)
}

async function getPaymentByReference(reference, userId = null) {
  const values = [reference]
  const ownerClause = userId === null ? '' : 'AND p.user_id = ?'
  if (userId !== null) values.push(userId)
  const [rows] = await pool.execute(
    `SELECT p.id AS payment_id, p.user_id, p.advertisement_id, p.amount, p.currency,
            p.status AS payment_status, p.provider_reference, p.provider_checkout_id,
            pr.id AS promotion_id,
            pr.status AS promotion_status
     FROM payment_transactions p
     JOIN promotions pr ON pr.payment_id = p.id
     WHERE p.provider = 'bachs' AND p.provider_reference = ? ${ownerClause}
     LIMIT 1`,
    values,
  )
  return rows[0] || null
}

async function getPaymentByCheckoutId(checkoutId) {
  const [rows] = await pool.execute(
    `SELECT p.id AS payment_id, p.user_id, p.advertisement_id, p.amount, p.currency,
            p.status AS payment_status, p.provider_reference, p.provider_checkout_id,
            pr.id AS promotion_id, pr.status AS promotion_status
     FROM payment_transactions p
     JOIN promotions pr ON pr.payment_id = p.id
     WHERE p.provider = 'bachs' AND p.provider_checkout_id = ?
     LIMIT 1`,
    [checkoutId],
  )
  return rows[0] || null
}

async function failPendingPayment(reference, event = null) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute(
      `SELECT id FROM payment_transactions
       WHERE provider = 'bachs' AND provider_reference = ? AND status = 'pending' FOR UPDATE`,
      [reference],
    )
    if (event) {
      const [inserted] = await connection.execute(
        `INSERT IGNORE INTO bachs_webhook_events (event_id, event_type) VALUES (?, ?)`,
        [event.id, event.type],
      )
      if (!inserted.affectedRows) {
        await connection.commit()
        return { alreadyProcessed: true }
      }
    }
    if (rows.length) {
      await connection.execute(
        `UPDATE payment_transactions SET status = 'failed'
         WHERE id = ? AND status = 'pending'`,
        [rows[0].id],
      )
      await connection.execute(
        `UPDATE promotions SET status = 'failed'
         WHERE payment_id = ? AND status = 'pending_payment'`,
        [rows[0].id],
      )
    }
    await connection.commit()
    return { alreadyProcessed: false }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function failPendingPaymentByCheckoutId(checkoutId, event) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [inserted] = await connection.execute(
      `INSERT IGNORE INTO bachs_webhook_events (event_id, event_type) VALUES (?, ?)`,
      [event.id, event.type],
    )
    if (!inserted.affectedRows) {
      await connection.commit()
      return { alreadyProcessed: true }
    }
    const [rows] = await connection.execute(
      `SELECT id FROM payment_transactions
       WHERE provider = 'bachs' AND provider_checkout_id = ? AND status = 'pending'
       FOR UPDATE`,
      [checkoutId],
    )
    if (rows.length) {
      await connection.execute(
        `UPDATE payment_transactions SET status = 'failed'
         WHERE id = ? AND status = 'pending'`,
        [rows[0].id],
      )
      await connection.execute(
        `UPDATE promotions SET status = 'failed'
         WHERE payment_id = ? AND status = 'pending_payment'`,
        [rows[0].id],
      )
    }
    await connection.commit()
    return { alreadyProcessed: false }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function completeVerifiedPayment(checkoutId, verified, event = null) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute(
      `SELECT p.id AS payment_id, p.user_id, p.amount, p.currency, p.status AS payment_status,
              p.provider_reference, p.provider_checkout_id,
              pr.id AS promotion_id, pr.status AS promotion_status,
              pr.duration_days, pr.advertisement_id, a.status AS advertisement_status
       FROM payment_transactions p
       JOIN promotions pr ON pr.payment_id = p.id
       LEFT JOIN advertisements a ON a.id = pr.advertisement_id
       WHERE p.provider = 'bachs' AND p.provider_checkout_id = ? FOR UPDATE`,
      [checkoutId],
    )
    if (!rows.length) throw makeError('Payment reference not found.', 404)
    const payment = rows[0]

    if (!checkoutMatchesPayment(payment, verified)) {
      throw makeError('Payment verification details do not match this order.', 400)
    }
    if (event) {
      const [inserted] = await connection.execute(
        `INSERT IGNORE INTO bachs_webhook_events (event_id, event_type) VALUES (?, ?)`,
        [event.id, event.type],
      )
      if (!inserted.affectedRows) {
        await connection.commit()
        return { alreadyProcessed: true, promotionId: payment.promotion_id, status: payment.promotion_status }
      }
    }
    if (payment.payment_status === 'succeeded') {
      await connection.commit()
      return { alreadyProcessed: true, promotionId: payment.promotion_id, status: payment.promotion_status }
    }
    if (!['pending', 'failed'].includes(payment.payment_status)) {
      throw makeError('This payment is no longer available for verification.', 409)
    }

    const promotionStatus = payment.advertisement_status === 'approved'
      ? 'active'
      : payment.advertisement_status === 'pending'
        ? 'pending_approval'
        : 'paused'
    await connection.execute(
      `UPDATE payment_transactions
       SET status = 'succeeded', verified_at = CURRENT_TIMESTAMP,
           provider_payment_id = ?
       WHERE id = ? AND status IN ('pending', 'failed')`,
      [verified.charge?.payment_id || null, payment.payment_id],
    )
    await connection.execute(
      `UPDATE promotions
       SET status = ?,
           starts_at = IF(? = 'active', CURRENT_TIMESTAMP, NULL),
           expires_at = IF(? = 'active', DATE_ADD(CURRENT_TIMESTAMP, INTERVAL duration_days DAY), NULL)
       WHERE id = ? AND status IN ('pending_payment', 'failed')`,
      [promotionStatus, promotionStatus, promotionStatus, payment.promotion_id],
    )
    await connection.commit()
    return { alreadyProcessed: false, promotionId: payment.promotion_id, status: promotionStatus }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function activateApprovedAdvertisement(connection, advertisementId) {
  await connection.execute(
    `UPDATE promotions
     SET status = 'active', starts_at = CURRENT_TIMESTAMP,
         expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL duration_days DAY)
     WHERE advertisement_id = ? AND status = 'pending_approval'
       AND expires_at IS NULL
       AND EXISTS (
         SELECT 1 FROM advertisements a
         WHERE a.id = promotions.advertisement_id AND a.status = 'approved'
       )`,
    [advertisementId],
  )
}

async function pauseAdvertisementPromotions(connection, advertisementId) {
  await connection.execute(
    `UPDATE promotions SET status = 'paused'
     WHERE advertisement_id = ? AND status = 'active'`,
    [advertisementId],
  )
}

// Expiring promotions is a write. Running it on every public page view made the
// homepage featured query wait on row locks, so run it at most once a minute.
const EXPIRE_INTERVAL_MS = 60 * 1000
let lastExpiryRun = 0

async function expireDuePromotions() {
  const now = Date.now()
  if (now - lastExpiryRun < EXPIRE_INTERVAL_MS) return 0
  lastExpiryRun = now
  const [result] = await pool.execute(
    `UPDATE promotions SET status = 'expired'
     WHERE status = 'active' AND expires_at <= CURRENT_TIMESTAMP`,
  )
  return result.affectedRows
}

async function listForUser(userId) {
  await expireDuePromotions()
  const [rows] = await pool.execute(
    `SELECT pr.id, pr.advertisement_id, a.title AS advertisement_title, a.status AS advertisement_status,
            pr.package_id, pp.name AS package_name, pr.duration_days,
            p.amount, p.currency, p.provider_reference,
            p.status AS payment_status, pr.status AS promotion_status, pr.starts_at,
            pr.expires_at, pr.impressions, pr.clicks, pr.created_at
     FROM promotions pr
     JOIN promotion_packages pp ON pp.id = pr.package_id
     JOIN payment_transactions p ON p.id = pr.payment_id
     LEFT JOIN advertisements a ON a.id = pr.advertisement_id
     WHERE pr.user_id = ? ORDER BY pr.created_at DESC LIMIT 100`,
    [userId],
  )
  return rows
}

async function findFeaturedAdvertisements({ limit = 8, offset = 0 } = {}) {
  await expireDuePromotions()
  const adModel = require('./adModel')
  return adModel.findPublic({
    where: `WHERE a.status = 'approved'
      AND EXISTS (SELECT 1 FROM promotions pr WHERE pr.advertisement_id = a.id
        AND pr.status = 'active' AND pr.expires_at > CURRENT_TIMESTAMP)`,
    orderBy: 'a.views DESC, a.created_at DESC, a.id DESC',
    limit,
    offset,
  })
}

async function trackAdvertisement(advertisementId, event) {
  const column = event === 'click' ? 'clicks' : 'impressions'
  const [result] = await pool.execute(
    `UPDATE promotions pr
     JOIN advertisements a ON a.id = pr.advertisement_id
     SET pr.${column} = pr.${column} + 1
     WHERE pr.advertisement_id = ? AND pr.status = 'active'
       AND pr.expires_at > CURRENT_TIMESTAMP AND a.status = 'approved'`,
    [advertisementId],
  )
  return result.affectedRows > 0
}

async function savePackage({ id, name, description, price, durationDays, benefits, isActive }) {
  if (id) {
    const [result] = await pool.execute(
      `UPDATE promotion_packages
       SET name = ?, description = ?, price = ?, duration_days = ?, benefits = ?, is_active = ?
       WHERE id = ?`,
      [name, description, price, durationDays, benefits, isActive, id],
    )
    if (!result.affectedRows) throw makeError('Promotion package not found.', 404)
    return Number(id)
  }
  const [result] = await pool.execute(
    `INSERT INTO promotion_packages (name, description, price, duration_days, benefits, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, description, price, durationDays, benefits, isActive],
  )
  return result.insertId
}

async function listAdminPromotions({ status, page, limit }) {
  await expireDuePromotions()
  const where = status ? 'WHERE pr.status = ?' : ''
  const values = status ? [status] : []
  const [rows] = await pool.execute(
    `SELECT pr.id, pr.user_id, u.full_name AS seller_name, pr.advertisement_id,
            a.title AS advertisement_title, pp.name AS package_name, p.amount,
            p.status AS payment_status, pr.status, pr.starts_at, pr.expires_at,
            pr.impressions, pr.clicks, pr.created_at
     FROM promotions pr JOIN users u ON u.id = pr.user_id
     JOIN promotion_packages pp ON pp.id = pr.package_id
     JOIN payment_transactions p ON p.id = pr.payment_id
     LEFT JOIN advertisements a ON a.id = pr.advertisement_id
     ${where} ORDER BY pr.created_at DESC LIMIT ? OFFSET ?`,
    [...values, limit, (page - 1) * limit],
  )
  const [count] = await pool.execute(`SELECT COUNT(*) AS total FROM promotions pr ${where}`, values)
  return { promotions: rows, total: Number(count[0].total) }
}

async function moderatePromotion({ id, administratorId, status, reqMeta }) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute(
      `SELECT id, user_id, status FROM promotions WHERE id = ? FOR UPDATE`,
      [id],
    )
    if (!rows.length) { await connection.rollback(); return false }
    const promotion = rows[0]
    if (!['paused', 'terminated'].includes(status)) throw makeError('Unsupported promotion action.')
    if (!['active', 'pending_approval', 'paused'].includes(promotion.status)) {
      throw makeError('This promotion cannot be changed in its current state.', 409)
    }
    await connection.execute('UPDATE promotions SET status = ? WHERE id = ?', [status, id])
    await connection.execute(
      `INSERT INTO admin_audit_logs
       (administrator_id, action, entity_type, entity_id, previous_value, new_value, ip_address, user_agent)
       VALUES (?, ?, 'promotion', ?, ?, ?, ?, ?)`,
      [administratorId, status === 'paused' ? 'pause' : 'terminate', id,
        JSON.stringify({ status: promotion.status }), JSON.stringify({ status }),
        reqMeta.ipAddress || null, reqMeta.userAgent?.slice(0, 500) || null],
    )
    await connection.commit()
    return true
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function getMonetization({ from, to }) {
  await expireDuePromotions()
  const dateFilters = from && to ? 'AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)' : ''
  const dateValues = from && to ? [from, to] : []
  const [payments] = await pool.execute(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'succeeded' AND verified_at IS NOT NULL ${dateFilters} THEN amount ELSE 0 END), 0) AS revenue,
       SUM(status = 'succeeded' AND verified_at IS NOT NULL ${dateFilters}) AS successful,
       SUM(status = 'pending' ${dateFilters}) AS pending,
       SUM(status = 'failed' ${dateFilters}) AS failed,
       COALESCE(SUM(CASE WHEN status = 'succeeded' AND verified_at >= CURRENT_DATE AND verified_at IS NOT NULL THEN amount ELSE 0 END), 0) AS today_revenue,
       COALESCE(SUM(CASE WHEN status = 'succeeded' AND verified_at >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01') AND verified_at IS NOT NULL THEN amount ELSE 0 END), 0) AS month_revenue
     FROM payment_transactions WHERE 1 = 1`,
    [...dateValues, ...dateValues, ...dateValues, ...dateValues],
  )
  const [promotionCounts] = await pool.query(
    `SELECT SUM(status = 'active' AND expires_at > CURRENT_TIMESTAMP) AS active,
            SUM(status = 'expired' OR (status = 'active' AND expires_at <= CURRENT_TIMESTAMP)) AS expired
     FROM promotions`,
  )
  const [dailyRevenue] = await pool.execute(
    `SELECT DATE(verified_at) AS date, SUM(amount) AS revenue
     FROM payment_transactions WHERE status = 'succeeded' AND verified_at IS NOT NULL
       ${from && to ? 'AND verified_at >= ? AND verified_at < DATE_ADD(?, INTERVAL 1 DAY)' : 'AND verified_at >= DATE_SUB(CURRENT_DATE, INTERVAL 29 DAY)'}
     GROUP BY DATE(verified_at) ORDER BY date ASC`,
    from && to ? [from, to] : [],
  )
  const [topPromotions] = await pool.query(
    `SELECT pr.id, pr.advertisement_id, a.title, u.full_name AS seller_name,
            SUM(pr.impressions) AS impressions, SUM(pr.clicks) AS clicks
     FROM promotions pr LEFT JOIN advertisements a ON a.id = pr.advertisement_id
     JOIN users u ON u.id = pr.user_id
     WHERE pr.status IN ('active', 'expired', 'paused', 'terminated')
     GROUP BY pr.id, pr.advertisement_id, a.title, u.full_name
     ORDER BY SUM(pr.clicks) DESC, SUM(pr.impressions) DESC LIMIT 10`,
  )
  return {
    stats: {
      revenue: Number(payments[0].revenue || 0),
      todayRevenue: Number(payments[0].today_revenue || 0),
      monthRevenue: Number(payments[0].month_revenue || 0),
      successfulPayments: Number(payments[0].successful || 0),
      pendingPayments: Number(payments[0].pending || 0),
      failedPayments: Number(payments[0].failed || 0),
      activePromotions: Number(promotionCounts[0].active || 0),
      expiredPromotions: Number(promotionCounts[0].expired || 0),
    },
    dailyRevenue,
    topPromotions,
  }
}

module.exports = {
  activateApprovedAdvertisement,
  completeVerifiedPayment,
  checkoutMatchesPayment,
  createPendingPromotion,
  expireDuePromotions,
  failPendingPayment,
  failPendingPaymentByCheckoutId,
  findFeaturedAdvertisements,
  findOwnedAdvertisement,
  getMonetization,
  getPaymentByCheckoutId,
  getPaymentByReference,
  listAdminPromotions,
  listForUser,
  listPackages,
  moderatePromotion,
  pauseAdvertisementPromotions,
  savePackage,
  saveCheckoutSession,
  trackAdvertisement,
}