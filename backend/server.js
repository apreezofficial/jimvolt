const cors = require('cors')
const express = require('express')
const http = require('node:http')
const path = require('node:path')
require('dotenv').config({ path: path.resolve(__dirname, '.env') })

const { pool, connectDB, ensureCoreSchema } = require('./config/database')
const adRoutes = require('./routes/adRoutes')
const adminRoutes = require('./routes/adminRoutes')
const authRoutes = require('./routes/authRoutes')
const categoryRoutes = require('./routes/categoryRoutes')
const messageRoutes = require('./routes/messageRoutes')
const userRoutes = require('./routes/userRoutes')
const sellerRoutes = require('./routes/sellerRoutes')
const reportRoutes = require('./routes/reportRoutes')
const discoveryRoutes = require('./routes/discoveryRoutes')
const { router: seoRouter } = require('./routes/seoRoutes')
const paymentRoutes = require('./routes/paymentRoutes')
const { ensureInitialCategories } = require('./models/categoryModel')
const promotionModel = require('./models/promotionModel')
const { errorHandler, notFound } = require('./middleware/errorMiddleware')
const { createSocketServer } = require('./socket')
const { getAllowedOrigins } = require('./utils/allowedOrigins')

const app = express()
// Vercel overwrites X-Forwarded-For with the client IP. Trust only its nearest hop.
if (process.env.VERCEL === '1') app.set('trust proxy', 1)
let initialization
const allowedOrigins = getAllowedOrigins()

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true)
    return callback(new Error('This origin is not allowed by the CORS policy.'))
  },
}))
app.use((req, res, next) => {
  initializeBackend().then(() => next(), next)
})
app.use(express.json({
  limit: '1mb',
  verify(req, res, buffer) {
    if (req.originalUrl.startsWith('/api/payments/webhook')) req.rawBody = Buffer.from(buffer)
  },
}))
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { dotfiles: 'deny', maxAge: '1d' }))
app.use(express.static(path.resolve(__dirname, '../frontend/dist'), { index: false, maxAge: '1h' }))

app.get('/', (req, res) => res.json({ message: 'Jimvolt API is running successfully.' }))
app.get('/api/health', async (req, res, next) => {
  try {
    await pool.query('SELECT 1')
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/seller', sellerRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/ads', adRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/favorites', discoveryRoutes.favorites)
app.use('/api/recently-viewed', discoveryRoutes.recentlyViewed)
app.use('/api/admin', adminRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/', seoRouter)
app.use(notFound)
app.use(errorHandler)

function initializeBackend() {
  if (!initialization) {
    initialization = (async () => {
      if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        throw new Error('Set JWT_SECRET to a random secret of at least 32 characters.')
      }

      await connectDB()
      await ensureCoreSchema()
      await ensureInitialCategories()
    })().catch((error) => {
      initialization = undefined
      throw error
    })
  }
  return initialization
}

async function startServer({ port = Number(process.env.PORT || 5000), host } = {}) {
  await initializeBackend()

  const server = http.createServer(app)
  const io = createSocketServer(server, allowedOrigins)
  app.set('io', io)
  server.io = io
  const promotionExpiryTimer = setInterval(() => {
    promotionModel.expireDuePromotions().catch((error) => {
      console.error('Could not expire due promotions:', error.message)
    })
  }, 60 * 1000)
  promotionExpiryTimer.unref()
  server.once('close', () => clearInterval(promotionExpiryTimer))

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const address = server.address()
      console.log(`Jimvolt API listening on port ${typeof address === 'object' ? address.port : port}`)
      resolve(server)
    })
    server.once('error', reject)
  })
}

async function shutdownServer(server, closePool = () => pool.end()) {
  await new Promise((resolve) => server.io.close(resolve))
  await closePool()
}

if (require.main === module) {
  startServer()
    .then((server) => {
      let shuttingDown = false
      const shutdown = () => {
        if (shuttingDown) return
        shuttingDown = true
        shutdownServer(server).then(
          () => process.exit(0),
          (error) => {
            console.error('Graceful shutdown failed:', error.message)
            process.exit(1)
          },
        )
      }
      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
    })
    .catch(async (error) => {
      console.error('Server startup failed:', error.message)
      await pool.end()
      process.exit(1)
    })
}

module.exports = { app, initializeBackend, shutdownServer, startServer }
