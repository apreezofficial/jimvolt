const { pool } = require('../config/database')

const publicFields = `
  id, full_name, email, phone, role, profile_image, token_version,
  account_status, username,
  (SELECT sv.status = 'verified' FROM seller_verifications sv
   WHERE sv.user_id = users.id ORDER BY sv.id DESC LIMIT 1) AS is_verified,
  created_at,
  password_reset_token, password_reset_expires_at
`

async function create({ fullName, email, phone, passwordHash, username = null }) {
  const [result] = await pool.execute(
    'INSERT INTO users (full_name, email, phone, password, username) VALUES (?, ?, ?, ?, ?)',
    [fullName, email, phone || null, passwordHash, username],
  )
  return findById(result.insertId)
}

async function findByEmail(email) {
  const [rows] = await pool.execute(
    `SELECT ${publicFields}, password FROM users WHERE email = ? LIMIT 1`,
    [email],
  )
  return rows[0] || null
}

async function findByPhone(phone) {
  const [rows] = await pool.execute(
    `SELECT ${publicFields}, password FROM users WHERE phone = ? LIMIT 1`,
    [phone],
  )
  return rows[0] || null
}

/** Looks up by username, returning the password hash for login checks. */
async function findByUsername(username) {
  const [rows] = await pool.execute(
    `SELECT ${publicFields}, password FROM users WHERE username = ? LIMIT 1`,
    [username],
  )
  return rows[0] || null
}

async function findByGoogleSub(googleSub) {
  const [rows] = await pool.execute(`SELECT ${publicFields} FROM users WHERE google_sub = ? LIMIT 1`, [googleSub])
  return rows[0] || null
}

async function linkGoogleSub(id, googleSub) {
  await pool.execute(
    'UPDATE users SET google_sub = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [googleSub, id],
  )
}

async function findByEmailOrPhone(value) {
  const normalized = String(value).trim().toLowerCase()
  const phone = normalized.includes('@') ? null : normalized
  const [rows] = await pool.execute(
    `SELECT ${publicFields}, password FROM users WHERE ${phone ? 'phone = ?' : 'email = ?'} LIMIT 1`,
    [phone || normalized],
  )
  return rows[0] || null
}

async function findById(id) {
  const [rows] = await pool.execute(
    `SELECT ${publicFields} FROM users WHERE id = ? LIMIT 1`,
    [id],
  )
  return rows[0] || null
}

async function updateProfile(id, { fullName, phone, profileImage }) {
  await pool.execute(
    `UPDATE users
     SET full_name = ?, phone = ?, profile_image = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [fullName, phone || null, profileImage || null, id],
  )
  return findById(id)
}

/**
 * True when a username is held by another user, or was a seller's previous
 * public slug (old /@links must keep pointing at the same person).
 */
async function isUsernameTaken(username, exceptUserId = null) {
  const [current] = await pool.execute(
    'SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1',
    [username, exceptUserId ?? 0],
  )
  if (current.length) return true
  const [history] = await pool.execute(
    'SELECT user_id FROM seller_slug_history WHERE old_slug = ? AND user_id <> ? LIMIT 1',
    [username, exceptUserId ?? 0],
  )
  return history.length > 0
}

async function setUsername(id, username) {
  await pool.execute(
    'UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [username, id],
  )
}

/** Public-safe profile for /@username. Never includes email, phone or password. */
async function findPublicByUsername(username) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.username, u.profile_image, u.created_at AS member_since,
            (SELECT sv.status = 'verified' FROM seller_verifications sv
             WHERE sv.user_id = u.id ORDER BY sv.id DESC LIMIT 1) AS is_verified
     FROM users u
     WHERE u.username = ? AND u.account_status = 'active' LIMIT 1`,
    [username],
  )
  return rows[0] || null
}

async function updateProfileImage(id, profileImage) {
  await pool.execute(
    'UPDATE users SET profile_image = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [profileImage, id],
  )
  return findById(id)
}

async function updateEmail(id, email) {
  await pool.execute(
    'UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [email, id],
  )
  return findById(id)
}

async function setPendingEmail(id, email, tokenHash, expiresAt) {
  await pool.execute(
    `UPDATE users
     SET pending_email = ?, email_verification_token = ?,
         email_verification_expires_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [email, tokenHash, expiresAt, id],
  )
}

async function findByEmailVerificationToken(tokenHash) {
  const [rows] = await pool.execute(
    `SELECT id, pending_email FROM users
     WHERE email_verification_token = ? AND email_verification_expires_at > NOW()
     LIMIT 1`,
    [tokenHash],
  )
  return rows[0] || null
}

async function consumeEmailVerification(id, email, tokenHash) {
  const [result] = await pool.execute(
    `UPDATE users SET email = ?, pending_email = NULL, email_verification_token = NULL,
      email_verification_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND email_verification_token = ? AND email_verification_expires_at > NOW()`,
    [email, id, tokenHash],
  )
  if (!result.affectedRows) return null
  return findById(id)
}

async function setPasswordResetToken(id, tokenHash, expiresAt) {
  await pool.execute(
    'UPDATE users SET password_reset_token = ?, password_reset_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [tokenHash, expiresAt, id],
  )
}

async function clearPasswordResetToken(id) {
  await pool.execute(
    'UPDATE users SET password_reset_token = NULL, password_reset_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [id],
  )
}

async function findByResetToken(tokenHash) {
  const [rows] = await pool.execute(
    `SELECT ${publicFields}, password FROM users WHERE password_reset_token = ? AND password_reset_expires_at > NOW() LIMIT 1`,
    [tokenHash],
  )
  return rows[0] || null
}

async function updatePassword(id, passwordHash) {
  await pool.execute(
    'UPDATE users SET password = ?, token_version = token_version + 1, password_reset_token = NULL, password_reset_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [passwordHash, id],
  )
  return findById(id)
}

async function invalidateTokens(userId) {
  const [result] = await pool.execute(
    'UPDATE users SET token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [userId],
  )
  return result.affectedRows > 0
}

async function consumePasswordReset(id, passwordHash, tokenHash) {
  const [result] = await pool.execute(
    `UPDATE users SET password = ?, token_version = token_version + 1, password_reset_token = NULL,
      password_reset_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND password_reset_token = ? AND password_reset_expires_at > NOW()`,
    [passwordHash, id, tokenHash],
  )
  return result.affectedRows > 0
}

async function getDashboardStats(userId) {
  const [rows] = await pool.execute(
    `SELECT
       COUNT(*) AS total_advertisements,
       SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS active_advertisements,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_advertisements,
       SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_advertisements,
       COALESCE(SUM(views), 0) AS total_product_views
     FROM advertisements
     WHERE user_id = ?`,
    [userId],
  )

  const row = rows[0]
  return {
    totalAdvertisements: Number(row.total_advertisements || 0),
    activeAdvertisements: Number(row.active_advertisements || 0),
    pendingAdvertisements: Number(row.pending_advertisements || 0),
    rejectedAdvertisements: Number(row.rejected_advertisements || 0),
    totalProductViews: Number(row.total_product_views || 0),
  }
}

async function updateLastLogin(id) {
  await pool.execute(
    'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [id],
  )
}

async function findVerifiedSellers(limit = 8) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.username, u.profile_image, COUNT(a.id) AS advertisements,
            COALESCE(MAX(a.state), '') AS state
     FROM users u
     JOIN advertisements a ON a.user_id = u.id AND a.status = 'approved'
     WHERE (SELECT sv.status = 'verified' FROM seller_verifications sv
            WHERE sv.user_id = u.id ORDER BY sv.id DESC LIMIT 1) = TRUE
     GROUP BY u.id, u.full_name, u.username, u.profile_image
     ORDER BY COUNT(a.id) DESC
     LIMIT ?`,
    [limit],
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.full_name,
    username: row.username || null,
    profileImage: row.profile_image,
    ads: Number(row.advertisements),
    state: row.state,
  }))
}

async function findPublicSeller(id) {
  const [rows] = await pool.execute(
    `SELECT id, full_name, profile_image,
            (SELECT sv.status = 'verified' FROM seller_verifications sv
             WHERE sv.user_id = users.id ORDER BY sv.id DESC LIMIT 1) AS is_verified,
            created_at
     FROM users WHERE id = ? LIMIT 1`,
    [id],
  )
  const seller = rows[0]
  return seller ? {
    id: seller.id,
    name: seller.full_name,
    profileImage: seller.profile_image,
    isVerified: Boolean(seller.is_verified),
    createdAt: seller.created_at,
  } : null
}

async function getFavorites(userId) {
  const [rows] = await pool.execute(
    `SELECT advertisement_id FROM favourites WHERE user_id = ? ORDER BY created_at DESC`,
    [userId],
  )
  return rows.map((row) => row.advertisement_id)
}

async function addFavorite(userId, advertisementId) {
  const [advertisements] = await pool.execute(
    "SELECT id FROM advertisements WHERE id = ? AND status = 'approved' LIMIT 1",
    [advertisementId],
  )
  if (!advertisements.length) return false
  await pool.execute(
    `INSERT IGNORE INTO favourites (user_id, advertisement_id)
     VALUES (?, ?)`,
    [userId, advertisementId],
  )
  return true
}

async function removeFavorite(userId, advertisementId) {
  const [result] = await pool.execute(
    'DELETE FROM favourites WHERE user_id = ? AND advertisement_id = ?',
    [userId, advertisementId],
  )
  return result.affectedRows > 0
}

module.exports = {
  findByUsername,
  findByGoogleSub,
  linkGoogleSub,
  findPublicByUsername,
  isUsernameTaken,
  setUsername,
  addFavorite,
  clearPasswordResetToken,
  create,
  findVerifiedSellers,
  findByEmail,
  findByEmailVerificationToken,
  findByEmailOrPhone,
  findById,
  findByPhone,
  findByResetToken,
  findPublicSeller,
  getDashboardStats,
  getFavorites,
  invalidateTokens,
  setPasswordResetToken,
  setPendingEmail,
  updateEmail,
  consumeEmailVerification,
  consumePasswordReset,
  updateLastLogin,
  updatePassword,
  updateProfile,
  updateProfileImage,
  removeFavorite,
}
