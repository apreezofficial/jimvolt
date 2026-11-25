const { pool } = require('../config/database')

// Image bytes are never selected in list queries; they are served by getImage().
const listFields = `id, title, advertiser, link_url, alt_text, width, height, sort_order, is_active,
  starts_at, ends_at, created_at, updated_at, status, duration_days, owner_user_id, review_note`

async function listPublic() {
  const [rows] = await pool.execute(
    `SELECT id, title, link_url, alt_text, width, height, updated_at
     FROM banners
     WHERE is_active = TRUE AND status = 'active'
       AND (starts_at IS NULL OR starts_at <= CURRENT_TIMESTAMP)
       AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP)
     ORDER BY sort_order ASC, id ASC
     LIMIT 12`,
  )
  return rows
}

async function listAll() {
  const [rows] = await pool.execute(
    `SELECT b.id, b.title, b.advertiser, b.link_url, b.alt_text, b.width, b.height, b.sort_order, b.is_active,
            b.starts_at, b.ends_at, b.created_at, b.updated_at, b.status, b.duration_days, b.owner_user_id,
            b.review_note, u.full_name AS owner_name, u.email AS owner_email,
            p.amount AS paid_amount, p.status AS payment_status,
            (b.is_active AND b.status = 'active'
              AND (b.starts_at IS NULL OR b.starts_at <= CURRENT_TIMESTAMP)
              AND (b.ends_at IS NULL OR b.ends_at > CURRENT_TIMESTAMP)) AS is_live,
            (b.status = 'active' AND b.ends_at IS NOT NULL AND b.ends_at <= CURRENT_TIMESTAMP) AS is_expired
     FROM banners b
     LEFT JOIN users u ON u.id = b.owner_user_id
     LEFT JOIN payment_transactions p ON p.id = b.payment_id
     ORDER BY (b.status = 'pending_review') DESC, b.sort_order ASC, b.id ASC`,
  )
  return rows
}

async function getImage(id) {
  const [rows] = await pool.execute(
    `SELECT content_type, image_data, updated_at FROM banners
     WHERE id = ? AND is_active = TRUE AND status = 'active'
       AND (starts_at IS NULL OR starts_at <= CURRENT_TIMESTAMP)
       AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP)`,
    [id],
  )
  return rows[0] || null
}

// Admin preview: returns the image whether or not the banner is live.
async function getImageAny(id) {
  const [rows] = await pool.execute('SELECT content_type, image_data FROM banners WHERE id = ?', [id])
  return rows[0] || null
}

async function create({ title, advertiser, linkUrl, altText, image, sortOrder, isActive, startsAt, endsAt }) {
  const [result] = await pool.execute(
    `INSERT INTO banners (title, advertiser, link_url, alt_text, image_data, content_type, width, height,
                          sort_order, is_active, starts_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, advertiser, linkUrl, altText, image.data, image.contentType, image.width, image.height,
      sortOrder, isActive, startsAt, endsAt],
  )
  return findById(result.insertId)
}

async function findById(id) {
  const [rows] = await pool.execute(`SELECT ${listFields} FROM banners WHERE id = ?`, [id])
  return rows[0] || null
}

async function update(id, { title, advertiser, linkUrl, altText, image, sortOrder, isActive, startsAt, endsAt }) {
  const [result] = await pool.execute(
    `UPDATE banners SET title = ?, advertiser = ?, link_url = ?, alt_text = ?, sort_order = ?, is_active = ?,
            starts_at = ?, ends_at = ?,
            image_data = COALESCE(?, image_data), content_type = COALESCE(?, content_type),
            width = COALESCE(?, width), height = COALESCE(?, height),
            updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [title, advertiser, linkUrl, altText, sortOrder, isActive, startsAt, endsAt,
      image?.data ?? null, image?.contentType ?? null, image?.width ?? null, image?.height ?? null, id],
  )
  return result.affectedRows ? findById(id) : null
}

async function remove(id) {
  const [result] = await pool.execute('DELETE FROM banners WHERE id = ?', [id])
  return result.affectedRows > 0
}

module.exports = { create, findById, getImage, getImageAny, listAll, listPublic, remove, update }
