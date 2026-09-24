const { createLogger, format, transports } = require('winston');

const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: format.combine(
    format.timestamp({ format: 'HH:mm:ss' }),
    format.errors({ stack: true }),
    format.printf((info) => {
      const { timestamp, level, message, stack } = info;
      const lvl = level.toUpperCase().padEnd(5);
      return `[${timestamp}] ${lvl} ${stack || message}`;
    })
  ),
  transports: [
    new transports.Console({
      handleExceptions: true,
    }),
  ],
});

module.exports = logger;