/* ============================================================
   In-memory MongoDB — FIXED PORT 27017
   Compass: mongodb://127.0.0.1:27017
   ============================================================ */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

let memoryServer = null;

const FIXED_PORT = 27017;

module.exports = async function connectMemoryDB() {
  try {
    memoryServer = await MongoMemoryServer.create({
      instance: {
        dbName: 'saaphzone',
        port: FIXED_PORT,
      },
    });

    const uri = memoryServer.getUri();
    logger.info(`🧠 In-memory MongoDB running on port ${FIXED_PORT}`);
    logger.info(`   Compass URI: mongodb://127.0.0.1:${FIXED_PORT}`);

    await mongoose.connect(uri);
    logger.info('✅ In-memory MongoDB connected');

    process.on('SIGINT', async () => {
      await mongoose.disconnect();
      if (memoryServer) await memoryServer.stop();
      process.exit(0);
    });
  } catch (e) {
    logger.error('❌ In-memory MongoDB failed: ' + e.message);
    throw e;
  }
};