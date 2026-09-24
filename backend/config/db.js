const mongoose = require('mongoose');
const logger = require('../utils/logger');

module.exports = async function connectDB() {
  /* ---------- In-memory mode (no MongoDB install needed) ---------- */
  if (process.env.USE_MEMORY_DB === 'true') {
    return require('./db.memory')();
  }

  /* ---------- Real MongoDB ---------- */
  const uri = process.env.MONGO_URI;
  if (!uri || uri.includes('xxxxx')) {
    logger.error('❌ MONGO_URI invalid or placeholder');
    logger.error('   → Set USE_MEMORY_DB=true in .env, OR provide real MONGO_URI');
    throw new Error('Invalid MONGO_URI');
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    logger.info('✅ MongoDB connected');
  } catch (e) {
    logger.error('❌ MongoDB connection failed: ' + e.message);
    throw e;
  }
};