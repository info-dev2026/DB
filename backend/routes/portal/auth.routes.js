/* ============================================================
   routes/portal/auth.routes.js — Sequelize version
   ============================================================ */

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Site } = require('../../models');

/* Helper: strip sensitive fields */
function toUserJSON(u) {
  if (!u) return null;
  const p = u.toJSON ? u.toJSON() : u;
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    login: p.login,
    mobile: p.mobile,
    email: p.email,
    siteId: p.siteCode,
  };
}

/* ------------------------------------------------------------
   POST /api/portal/auth/login
   Body: { role, login, password }
   ------------------------------------------------------------ */
router.post('/login', async (req, res, next) => {
  try {
    const { role, login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Login and password required' });
    }

    const user = await User.findOne({
      where: { login: String(login).toLowerCase().trim() },
    });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    if (role && user.role !== role) {
      return res.status(401).json({ error: 'Invalid credentials for this role' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        login: user.login,
        siteId: user.siteCode,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || '8h' }
    );

    res.json({ token, user: toUserJSON(user) });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------
   POST /api/portal/auth/register — admin-only in practice
   (used by seeding; not exposed in the UI)
   ------------------------------------------------------------ */
router.post('/register', async (req, res, next) => {
  try {
    const { name, role, login, password, mobile, email, siteId } = req.body;
    if (!name || !role || !login || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      role,
      login: String(login).toLowerCase().trim(),
      passwordHash,
      mobile: mobile || '',
      email: email || '',
      siteCode: siteId || null,
    });

    res.status(201).json(toUserJSON(user));
  } catch (e) {
    if (e.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Login already exists' });
    }
    next(e);
  }
});

module.exports = router;