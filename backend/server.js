require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const connectDB = require('./config/db');
const logger = require('./utils/logger');
const { initSocket } = require('./services/socketService');
const { startCronJobs } = require('./jobs/cronJobs');

const app = express();
const server = http.createServer(app);

/* ---------- CORS config (supports localhost, custom domain, Vercel) ---------- */
const corsOrigin = process.env.CLIENT_ORIGIN
  ? (process.env.CLIENT_ORIGIN.includes(',') ? process.env.CLIENT_ORIGIN.split(',').map(s => s.trim()) : process.env.CLIENT_ORIGIN)
  : true;

/* ---------- Socket.IO ---------- */
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    credentials: true,
  },
});
initSocket(io);

/* ---------- Global middleware ---------- */
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
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

/* ---------- Boot ---------- */
(async () => {
  try {
    await connectDB();

    /* Auto-seed empty database */
    if (
      process.env.USE_MEMORY_DB === 'true' ||
      process.env.AUTO_SEED === 'true'
    ) {
      const Site = require('./models/Site');
      const count = await Site.countDocuments();
      if (count === 0) {
        logger.info('🌱 Database empty — seeding demo data...');
        const runSeed = require('./utils/seed.runner');
        await runSeed();
      }
    }

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