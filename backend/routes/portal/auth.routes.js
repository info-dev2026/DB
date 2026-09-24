const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const Site = require('../../models/Site');

/* ============================================================
   POST /api/portal/auth/login
   Body: { role, login, password }
   ============================================================ */
router.post('/login', async (req, res, next) => {
  try {
    const { role, login, password } = req.body || {};
    if (!role || !login || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    /* ---------------- Industry login ---------------- */
    if (role === 'industry') {
      const site = await Site.findOne({ id: login.toUpperCase().trim() });
      if (!site) return res.status(401).json({ error: 'Industry code not found' });
      if (password !== site.passcode) {
        return res.status(401).json({ error: 'Incorrect passcode' });
      }

      const token = jwt.sign(
        { role, siteId: site.id, name: site.name },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES || '8h' }
      );
      return res.json({
        token,
        user: { role, siteId: site.id, name: site.name },
      });
    }

    /* ---------------- Admin / Engineer / Sales login ---------------- */
    const user = await User.findOne({
      login: login.toLowerCase().trim(),
      role,
    });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      {
        role,
        sub: user._id.toString(),
        name: user.name,
        mobile: user.mobile || '',
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || '8h' }
    );

    res.json({
      token,
      user: { role, name: user.name, mobile: user.mobile || '' },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;