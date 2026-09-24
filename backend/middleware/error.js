const logger = require('../utils/logger');

/* Central error handler — must be added LAST in server.js */
module.exports = (err, req, res, _next) => {
  logger.error(err.stack || err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Server error',
  });
};