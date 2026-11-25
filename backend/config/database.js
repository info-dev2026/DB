const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

/* ============================================================
   Sequelize instance — reads DATABASE_URL from .env
   - Local dev: uses Render's EXTERNAL URL
   - On Render: uses Render's INTERNAL URL (set in dashboard)
   ============================================================ */

const url =
  process.env.DATABASE_URL ||
  'postgresql://saaphzone_user:2ojnbmErthu0g3WkAjIy0kG3C8x9us5l@dpg-dar1uc8473hc739hmh80-a.ohio-postgres.render.com/saaphzone';

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