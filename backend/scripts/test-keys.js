const { generatePortalKey, generateLoggerKey } = require('../utils/apiKeys');

console.log('Portal key:', generatePortalKey());
console.log('Logger key:', generateLoggerKey());