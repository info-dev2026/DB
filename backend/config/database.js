const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

/* ============================================================
   Sequelize instance — reads DATABASE_URL from .env
   - Local dev: uses Render's EXTERNAL URL
   - On Render: uses Render's INTERNAL URL (set in dashboard)
   ============================================================ */

const url = process.env.DATABASE_URL;

if (!url) {
  logger.error('❌ DATABASE_URL missing in .env');
  throw new Error('DATABASE_URL not set');
}

const isProduction = process.env.NODE_ENV === 'production';

const sequelize = new Sequelize(url, {
  dialect: 'postgres',
  logging: false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  dialectOptions: {
    // Render Postgres uses a CA that Node doesn't trust by default.
    // This keeps the connection TLS-encrypted but skips CA validation.
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
});

module.exports = sequelize;