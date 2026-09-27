require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const logger = require('./logger');
const runSeed = require('./seed.runner');

(async () => {
  try {
    await connectDB();
    await runSeed();
    await mongoose.disconnect();
    process.exit(0);
  } catch (e) {
    logger.error('❌ Seed failed: ' + e.message);
    process.exit(1);
  }
})();