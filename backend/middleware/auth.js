const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'sz_saaphzone_secure_jwt_secret_token_2026';

/* JWT authentication. Usage:
     auth()             → any authenticated user
     auth('admin')      → admin only
     auth(['admin','engineer']) → admin OR engineer
*/
module.exports = function auth(requiredRole) {
  return (req, res, next) => {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;

      if (requiredRole) {
        const allowed = Array.isArray(requiredRole)
          ? requiredRole
          : [requiredRole];
        if (!allowed.includes(payload.role)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
};