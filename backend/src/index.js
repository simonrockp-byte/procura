'use strict';
require('dotenv').config();

const path    = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { pool } = require('./db');

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRouter         = require('./routes/auth');
const requisitionsRouter = require('./routes/requisitions');
const suppliersRouter    = require('./routes/suppliers');
const deliveriesRouter   = require('./routes/deliveries');
const paymentsRouter     = require('./routes/payments');
const dashboardRouter    = require('./routes/dashboard');
const officersRouter     = require('./routes/officers');
const reportsRouter      = require('./routes/reports');
const webhookRouter      = require('./routes/webhook');

const app = express();

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
// Note: webhook route uses its own raw body via express.json() inline
// so that X-Hub-Signature-256 verification can read the raw payload.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/webhook')) return next(); // handled per-route
  express.json({ limit: '2mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: false }));

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts — try again in 15 minutes' },
});

app.use(globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
  } catch {
    return res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',         authRouter);
app.use('/api/requisitions', requisitionsRouter);
app.use('/api/suppliers',    suppliersRouter);
app.use('/api/deliveries',   deliveriesRouter);
app.use('/api/payments',     paymentsRouter);
app.use('/api/dashboard',    dashboardRouter);
app.use('/api/officers',     officersRouter);
app.use('/api/reports',       reportsRouter);
app.use('/api/webhook',      webhookRouter);

// ─── Serve frontend build (production) ───────────────────────────────────────
if (config.env === 'production') {
  const dist = path.resolve(__dirname, '../../dist');
  app.use(express.static(dist, { index: false })); // handle index explicitly below
  // All non-API GET requests return the SPA shell
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
    }
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// ─── 404 (development only) ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (err.message && err.message.includes('Only image files')) {
    return res.status(415).json({ error: err.message });
  }
  console.error('[app] unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(config.port, () => {
  console.log(`\n🚀 Procura API running on port ${config.port} [${config.env}]`);
  console.log(`   Health: http://localhost:${config.port}/health`);
  console.log(`   WhatsApp webhook: http://localhost:${config.port}/api/webhook/whatsapp\n`);
});

process.on('SIGTERM', async () => {
  console.log('[app] SIGTERM — closing server …');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});

module.exports = app;
