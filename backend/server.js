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

const server = http.createServer(app);

/* ---------- Socket.IO ---------- */
const io = new Server(server, {
  cors: {
    origin: ALLOWED,
    credentials: true,
  },
});
initSocket(io);

/* ---------- Global middleware ---------- */
app.use(helmet({ crossOriginResourcePolicy: false }));

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow non-browser clients (curl, Postman, mobile apps) that send no Origin
      if (!origin) return cb(null, true);
      // Allow only origins explicitly listed in CLIENT_ORIGIN
      if (ALLOWED.includes(origin)) return cb(null, true);
      // Reject everything else
      cb(new Error('CORS not allowed: ' + origin));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '5mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

/* ---------- Health check ---------- */
app.get('/api/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

/* ---------- Datalogger API ---------- */
app.use('/api/datalogger', require('./routes/datalogger.routes'));

/* ---------- Portal API ---------- */
app.use('/api/portal', require('./routes/portal'));

/* ---------- Error handler ---------- */
app.use(require('./middleware/error'));

/* ---------- Seed if empty ---------- */
async function seedIfEmpty() {
  const userCount = await User.count();
  if (userCount > 0) return;

  logger.info('🌱 Seeding default users...');

  const pass = await bcrypt.hash('Rn4$KpV9!TzL3wXq', 10);
  await User.create({
    name: 'Admin',
    role: 'admin',
    login: 'admin',
    passwordHash: pass,
    mobile: '',
    email: '',
    siteCode: null,
  });

  const engPass = await bcrypt.hash('Dm8#WcF2@Ys6PbH5', 10);
  await User.create({
    name: 'Engineer',
    role: 'engineer',
    login: 'engineer',
    passwordHash: engPass,
    mobile: '',
    email: '',
    siteCode: null,
  });

  logger.info('   admin / Rn4$KpV9!TzL3wXq');
  logger.info('   engineer / Dm8#WcF2@Ys6PbH5');
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
    });
  } catch (e) {
    logger.error('Failed to start server: ' + e.message);
    process.exit(1);
  }
})();