/* ============================================================
   middleware/apiKeyAuth.js

   Authenticates portal requests via X-API-Key header.
   Falls back to JWT (Bearer token) if no API key is provided.

   Usage in routes — identical to the existing auth middleware:
     const auth = require('../../middleware/apiKeyAuth');
     router.get('/', auth(), async (req, res) => {...});
     router.post('/', auth(['admin', 'engineer']), async (req, res) => {...});
   ============================================================ */

const jwt = require('jsonwebtoken');
const { User } = require('../models');

module.exports = function apiKeyAuth(requiredRole) {
  return async (req, res, next) => {
    try {
      /* ---------- 1. Try X-API-Key header ---------- */
      const apiKey = req.headers['x-api-key'];
      if (apiKey) {
        const user = await User.findOne({ where: { apiKey } });
        if (!user) {
          return res.status(401).json({ error: 'Invalid API key' });
        }
        req.user = {
          userId: user.id,
          role: user.role,
          login: user.login,
          siteId: user.siteCode,
          viaApiKey: true,
        };
        return checkRole(req, res, next, requiredRole);
      }

      /* ---------- 2. Fall back to JWT ---------- */
      const hdr = req.headers.authorization || '';
      const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
      if (!token) {
        return res.status(401).json({
          error: 'No API key or token provided',
        });
      }

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = payload;
      return checkRole(req, res, next, requiredRole);
    } catch (e) {
      return res.status(401).json({
        error: 'Invalid or expired credentials',
      });
    }
  };
};

function checkRole(req, res, next, requiredRole) {
  if (!requiredRole) return next();

  const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}