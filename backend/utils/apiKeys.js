/* ============================================================
   utils/apiKeys.js
   Generate secure random API keys.

   Key formats:
     Portal: sz_portal_<48 hex chars>
     Logger: sz_logger_<48 hex chars>

   48 hex chars = 24 random bytes = 192 bits of entropy.
   ============================================================ */

const crypto = require('crypto');

/**
 * Generate a random prefixed key.
 * @param {string} prefix - 'sz', 'sz_portal', 'sz_logger', etc.
 */
function generateKey(prefix = 'sz') {
  const random = crypto.randomBytes(24).toString('hex');
  return `${prefix}_${random}`;
}

module.exports = {
  generateKey,
  generatePortalKey: () => generateKey('sz_portal'),
  generateLoggerKey: () => generateKey('sz_logger'),
};