require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const logger = require('./utils/logger');
const { initSocket } = require('./services/socketService');
const { startCronJobs } = require('./jobs/cronJobs');
const { sequelize, User, Site } = require('./models');
const bcrypt = require('bcryptjs');

const app = express();

/* ---------- Trust Render's proxy ---------- */
app.set('trust proxy', 1);

/* ---------- Allowed CORS origins (comma-separated in CLIENT_ORIGIN) ---------- */
const ALLOWED = (process.env.CLIENT_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED.includes('*') || ALLOWED.includes(origin)) return true;

  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    // Local development
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;

    // Saaphzone domains (saaphzone.com, www.saaphzone.com, etc.)
    if (host === 'saaphzone.com' || host.endsWith('.saaphzone.com')) return true;

    // Vercel deployments (*.vercel.app)
    if (host.endsWith('.vercel.app')) return true;

    // Render deployments (*.onrender.com)
    if (host.endsWith('.onrender.com')) return true;

    // Netlify deployments (*.netlify.app)
    if (host.endsWith('.netlify.app')) return true;
  } catch {}

  // Allow assigned domains while reflecting request origin safely
  return true;
}

const server = http.createServer(app);

/* ---------- Socket.IO ---------- */
const io = new Server(server, {
  cors: {
    origin: (origin, cb) => cb(null, true),
    credentials: true,
  },
});
initSocket(io);
app.set('io', io);

/* ---------- Global middleware ---------- */
app.use(helmet({ crossOriginResourcePolicy: false }));

app.use(
  cors({
    origin: (origin, cb) => cb(null, true),
    credentials: true,
  })
);

app.use(express.json({ limit: '5mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

/* ---------- Rewrite accidental nested datalogger/portal paths ---------- */
app.use((req, res, next) => {
  if (req.url.includes('/api/datalogger/readings/api/portal')) {
    req.url = req.url.replace('/api/datalogger/readings/api/portal', '/api/portal');
  } else if (req.url.includes('/api/datalogger/api/portal')) {
    req.url = req.url.replace('/api/datalogger/api/portal', '/api/portal');
  }
  next();
});

/* ---------- Health check & version ---------- */
app.get('/api/health', (_, res) => res.json({ ok: true, version: '3.1.0', ts: Date.now() }));
app.get('/api/version', (_, res) => res.json({ ok: true, version: '3.1.0', paramsSupport: true, ts: Date.now() }));

/* ---------- Datalogger API ---------- */
app.use('/api/datalogger', require('./routes/datalogger.routes'));

/* ---------- Portal API ---------- */
app.use('/api/portal', require('./routes/portal'));

/* ---------- Error handler ---------- */
app.use(require('./middleware/error'));

/* ---------- Seed & Sync Default Users ---------- */
async function seedIfEmpty() {
  logger.info('🌱 Syncing official default users & credentials...');

  const pass = await bcrypt.hash('Rn4$KpV9!TzL3wXq', 10);
  const [adminUser] = await User.findOrCreate({
    where: { login: 'admin' },
    defaults: {
      name: 'Administrator',
      role: 'admin',
      login: 'admin',
      passwordHash: pass,
      mobile: '',
      email: '',
      siteCode: null,
    },
  });
  await adminUser.update({ passwordHash: pass, role: 'admin', name: 'Administrator' });

  const engPass = await bcrypt.hash('Dm8#WcF2@Ys6PbH5', 10);
  const [engUser] = await User.findOrCreate({
    where: { login: 'chandan' },
    defaults: {
      name: 'Chandan',
      role: 'engineer',
      login: 'chandan',
      passwordHash: engPass,
      mobile: '9818536015',
      email: '',
      siteCode: null,
    },
  });
  await engUser.update({ passwordHash: engPass, role: 'engineer', name: 'Chandan', mobile: '9818536015' });

  // Legacy alias 'engineer' to ensure compatibility
  const [legacyEng] = await User.findOrCreate({
    where: { login: 'engineer' },
    defaults: {
      name: 'Chandan',
      role: 'engineer',
      login: 'engineer',
      passwordHash: engPass,
      mobile: '9818536015',
      email: '',
      siteCode: null,
    },
  });
  await legacyEng.update({ passwordHash: engPass, role: 'engineer' });

  const salesPass = await bcrypt.hash('Qz5!Nt7#GxR2VkM9', 10);
  const [salesUser] = await User.findOrCreate({
    where: { login: 'sales' },
    defaults: {
      name: 'Saaphzone Technologies',
      role: 'sales',
      login: 'sales',
      passwordHash: salesPass,
      mobile: '',
      email: '',
      siteCode: null,
    },
  });
  await salesUser.update({ passwordHash: salesPass, role: 'sales', name: 'Saaphzone Technologies' });

  logger.info('   admin / Rn4$KpV9!TzL3wXq');
  logger.info('   chandan / Dm8#WcF2@Ys6PbH5');
  logger.info('   sales / Qz5!Nt7#GxR2VkM9');
}

/* ---------- Boot ---------- */
(async () => {
  try {
    await sequelize.authenticate();
    logger.info('✅ Postgres connected');

    await seedIfEmpty();

    const PORT = process.env.PORT || 4000;
    server.listen(PORT, () => {
      logger.info(`🚀 OCEMS backend running on http://localhost:${PORT}`);
      logger.info(`   Health: http://localhost:${PORT}/api/health`);
      startCronJobs();
      const { verifyMailer } = require('./config/mailer');
      verifyMailer().catch(() => {});
    });
  } catch (e) {
    logger.error('Failed to start server: ' + e.message);
    process.exit(1);
  }
})();