#!/usr/bin/env node
/*
 * Seeds a super administrator and some demo products so a fresh database is usable.
 *
 *   node scripts/seedDemoData.js                 # create the admin, a demo seller and demo products
 *   node scripts/seedDemoData.js --remove-demo   # delete the demo seller and every demo product
 *
 * Settings (all optional):
 *   SEED_ADMIN_EMAIL     default admin@jimvolt.com
 *   SEED_ADMIN_PHONE     default 08011110001 (placeholder: change it in Account settings)
 *   SEED_ADMIN_PASSWORD  default: a random password, printed once at the end
 *
 * It is safe to run twice: an existing admin is left untouched (its password is never reset)
 * and demo products already present are skipped. Demo products have no photos, so listings show
 * the category picture until real photos are added. The demo seller is not marked as verified.
 */
const bcrypt = require('bcrypt')
const { randomBytes } = require('node:crypto')
const { pool, connectDB, ensureCoreSchema } = require('../config/database')
const { ensureInitialCategories } = require('../models/categoryModel')
const { isValidNigerianPhone, normalizeNigerianPhone } = require('../utils/phone')

const DEMO_SELLER_EMAIL = 'demo-seller@jimvolt.com'
const DEMO_SLUG_PREFIX = 'demo-'

// [category slug, title, brand, specifications, description, price (NGN), condition, state, city, featured]
const PRODUCTS = [
  ['solar-panels', 'JA Solar 550W Monocrystalline Panel', 'JA Solar', '550W, 144 half-cut cells, 25-year output warranty', 'High-efficiency mono PERC panel for homes and small businesses. Sold per panel; bulk pricing available for 10 or more.', 135000, 'new', 'Lagos', 'Ikeja', true],
  ['solar-panels', 'Canadian Solar 450W Panel (Used, Tested)', 'Canadian Solar', '450W, tested at 96% of rated output', 'Lightly used panels from a decommissioned install. Each panel is tested and comes with a 6-month shop warranty.', 78000, 'used', 'FCT Abuja', 'Wuse 2', false],
  ['solar-inverters', 'Growatt 5kVA 48V Hybrid Inverter', 'Growatt', '5kVA, 48V, built-in 80A MPPT, pure sine wave', 'Hybrid inverter that works with or without batteries. Includes WiFi monitoring and a 2-year warranty.', 620000, 'new', 'Lagos', 'Lekki', true],
  ['solar-inverters', 'Mercury 3.5kVA 24V Inverter', 'Mercury', '3.5kVA, 24V, pure sine wave, 60A PWM', 'Reliable off-grid inverter for a 2 to 3 bedroom flat. Pre-tested and delivered with fitting instructions.', 285000, 'new', 'Rivers', 'Port Harcourt', false],
  ['solar-batteries', 'Pylontech US5000 4.8kWh Lithium Battery', 'Pylontech', '48V, 4.8kWh, LiFePO4, 6000 cycles', 'Rack-mount LiFePO4 battery that pairs with most 48V hybrid inverters. Stackable up to 16 units.', 1150000, 'new', 'Lagos', 'Victoria Island', true],
  ['solar-batteries', '220Ah 12V Tubular Battery', 'Luminous', '12V, 220Ah, deep cycle tubular plate', 'Deep-cycle tubular battery for inverter systems. Two-year replacement warranty.', 245000, 'new', 'Oyo', 'Ibadan', false],
  ['solar-generators', '2000W Portable Solar Power Station', 'EcoFlow', '2000W output, 2048Wh, 4 AC outlets, solar input', 'Quiet portable power station for lights, fans, laptops and a small fridge. Charges from the wall, a car or solar panels.', 1350000, 'new', 'FCT Abuja', 'Garki', false],
  ['solar-street-lights', '60W All-in-One Solar Street Light', 'Jimvolt Select', '60W LED, 8000 lumens, motion sensor, dusk-to-dawn', 'Integrated solar street light with remote control and a pole mount bracket. Ideal for estates, schools and farms.', 68000, 'new', 'Kano', 'Kano Municipal', false],
  ['solar-water-pumps', '1HP Solar Borehole Pump Kit', 'Lorentz', '1HP DC pump, up to 60m head, controller included', 'Complete solar water pump kit for farms and estates. Panels sold separately; we can supply and install.', 520000, 'new', 'Kaduna', 'Kaduna North', false],
  ['solar-accessories', 'MPPT 60A Solar Charge Controller', 'Victron', '60A, 12/24/48V auto, LCD display', 'MPPT charge controller that gets more power from your panels than a basic PWM unit. Includes mounting screws.', 95000, 'new', 'Anambra', 'Onitsha', false],
  ['wind-energy-equipment', '1kW Small Wind Turbine Kit', 'Generic', '1kW, 3 blades, 48V, charge controller included', 'Small wind turbine for windy sites such as the coast and the north. Tower not included.', 430000, 'new', 'Lagos', 'Epe', false],
  ['solar-installation-services', 'Home Solar Installation (3kVA to 5kVA)', 'Jimvolt Installers', 'Site survey, installation, testing, 1-year workmanship warranty', 'Full installation by certified technicians: panels, inverter, batteries, wiring and earthing. Free site survey within Lagos.', 150000, 'new', 'Lagos', 'Surulere', false],
]

function slugify(value) {
  return String(value).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 150)
}

async function findUserId(email) {
  const [rows] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
  return rows[0]?.id ?? null
}

async function removeDemo() {
  const [sellers] = await pool.execute('SELECT id FROM users WHERE email = ?', [DEMO_SELLER_EMAIL])
  if (!sellers.length) return console.log('No demo seller found; nothing to remove.')
  const [ads] = await pool.execute('DELETE FROM advertisements WHERE user_id = ?', [sellers[0].id])
  await pool.execute('DELETE FROM users WHERE id = ?', [sellers[0].id])
  console.log(`Removed the demo seller and ${ads.affectedRows} demo products.`)
}

async function seed() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@jimvolt.com').trim().toLowerCase()
  const phone = normalizeNigerianPhone(process.env.SEED_ADMIN_PHONE || '08011110001')
  if (!isValidNigerianPhone(phone)) throw new Error('SEED_ADMIN_PHONE must be a valid Nigerian mobile number.')
  const suppliedPassword = process.env.SEED_ADMIN_PASSWORD
  if (suppliedPassword && suppliedPassword.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters.')

  await ensureInitialCategories()

  let adminCreated = false
  let generatedPassword = null
  let adminId = await findUserId(email)
  if (!adminId) {
    generatedPassword = suppliedPassword ? null : randomBytes(15).toString('base64url')
    const hash = await bcrypt.hash(suppliedPassword || generatedPassword, 12)
    const [result] = await pool.execute(
      "INSERT INTO users (full_name, email, phone, password, role, account_status) VALUES (?, ?, ?, ?, 'super_admin', 'active')",
      ['Jimvolt Admin', email, phone, hash],
    )
    adminId = result.insertId
    adminCreated = true
  }

  // The demo seller cannot log in: its password is a random hash nobody is given.
  let sellerId = await findUserId(DEMO_SELLER_EMAIL)
  if (!sellerId) {
    const [result] = await pool.execute(
      "INSERT INTO users (full_name, email, phone, password, role, account_status) VALUES (?, ?, ?, ?, 'user', 'active')",
      ['Jimvolt Demo Store', DEMO_SELLER_EMAIL, '+2348011110002', await bcrypt.hash(randomBytes(32).toString('hex'), 12)],
    )
    sellerId = result.insertId
  }

  const [categories] = await pool.execute('SELECT id, slug FROM categories')
  const categoryId = new Map(categories.map((row) => [row.slug, row.id]))
  let created = 0
  for (const [categorySlug, title, brand, specifications, description, price, condition, state, city, featured] of PRODUCTS) {
    if (!categoryId.has(categorySlug)) throw new Error(`Category "${categorySlug}" is missing.`)
    const slug = `${DEMO_SLUG_PREFIX}${slugify(title)}`
    const [existing] = await pool.execute('SELECT id FROM advertisements WHERE slug = ?', [slug])
    if (existing.length) continue
    await pool.execute(
      `INSERT INTO advertisements
         (user_id, category_id, title, brand, specifications, slug, description, price, condition_type,
          state, city, phone, whatsapp, status, approved_at, views, is_featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '+2348011110002', '+2348011110002', 'approved', CURRENT_TIMESTAMP, ?, ?)`,
      [sellerId, categoryId.get(categorySlug), title, brand, specifications, slug, description, price, condition,
        state, city, 20 + Math.floor(Math.random() * 480), featured],
    )
    created += 1
  }

  console.log(`Categories ready. Demo products added: ${created} (already present: ${PRODUCTS.length - created}).`)
  if (adminCreated) {
    console.log('\nSuper admin created. Sign in at /admin/login:')
    console.log(`  email:    ${email}`)
    console.log(`  password: ${generatedPassword || '(the SEED_ADMIN_PASSWORD you supplied)'}`)
    console.log('Change the password and phone number in Account settings after the first sign-in.')
  } else {
    console.log(`\nAn account for ${email} already exists, so it was left unchanged.`)
  }
}

async function main() {
  await connectDB()
  await ensureCoreSchema()
  if (process.argv.includes('--remove-demo')) await removeDemo()
  else await seed()
}

main()
  .catch((error) => {
    console.error('Seeding failed:', error.message)
    process.exitCode = 1
  })
  .finally(() => pool.end())
