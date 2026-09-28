/* ============================================================
   middleware/deviceAuth.js

   Authenticate device requests by x-device-key header.
   1. Looks up key in sites.logger_key (per-site keys)
   2. Falls back to global DEVICE_API_KEY for legacy support

   On success:
     req.site      = Sequelize Site instance (if per-site key)
     req.siteCode  = the site code (if per-site key)
   ============================================================ */

const { Site, User } = require('../models');

// Generic logger keys that work across ANY site
const GENERIC_LOGGER_KEYS = new Set([
  'sz_generic_logger_key_2026',
  'sz_logger_global_2026_key',
  'sz_device_key_change_me',
  process.env.DEVICE_API_KEY,
].filter(Boolean));

module.exports = async function deviceAuth(req, res, next) {
  try {
    const key = req.headers['x-device-key'] || req.headers['x-api-key'];
    if (!key) {
      return res.status(401).json({ error: 'Missing x-device-key or x-api-key header' });
    }

    /* ---------- 1. Generic / Global logger key (valid for all sites) ---------- */
    if (GENERIC_LOGGER_KEYS.has(key)) {
      req.site = null;
      req.siteCode = null;
      return next();
    }

    /* ---------- 2. Per-site logger key ---------- */
    const site = await Site.findOne({ where: { loggerKey: key } });
    if (site) {
      req.site = site;
      req.siteCode = site.siteCode;
      return next();
    }

    /* ---------- 3. Admin / portal API keys ---------- */
    const user = await User.findOne({ where: { apiKey: key } });
    if (user && (user.role === 'admin' || user.role === 'engineer')) {
      req.site = null;
      req.siteCode = null;
      return next();
    }

    return res.status(401).json({ error: 'Invalid logger key' });
  } catch (e) {
    return res.status(500).json({ error: 'Device auth failed' });
  }
};