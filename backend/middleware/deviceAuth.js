/* Auth for data logger hardware — uses a shared API key, not JWT */
module.exports = function deviceAuth(req, res, next) {
  const key = req.headers['x-device-key'] || req.headers['authorization'];
  const expected = process.env.DEVICE_API_KEY || 'sz_device_key_change_me';

  // Accept either "sz_key" or "Bearer sz_key"
  const provided = (key || '').replace(/^Bearer\s+/i, '');

  if (provided !== expected) {
    return res.status(401).json({ error: 'Invalid device key' });
  }
  next();
};