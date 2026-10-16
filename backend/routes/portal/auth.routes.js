/* ============================================================
   routes/portal/auth.routes.js — Sequelize version
   ============================================================ */

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Site, sequelize } = require('../../models');

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

/* Helper: authenticate an Industry Site */
async function authenticateSite(code, password, res) {
  const cleanCode = String(code).trim();
  const site = await Site.findOne({
    where: sequelize.where(
      sequelize.fn('lower', sequelize.col('site_code')),
      cleanCode.toLowerCase()
    ),
  });

  if (!site) {
    return res.status(401).json({ error: 'Industry code not found' });
  }

  let ok = false;
  if (site.passcode && (site.passcode.startsWith('$2a$') || site.passcode.startsWith('$2b$'))) {
    ok = await bcrypt.compare(password, site.passcode);
  } else {
    ok = (site.passcode === password);
  }

  if (!ok) {
    return res.status(401).json({ error: 'Incorrect passcode' });
  }

  const token = jwt.sign(
    {
      userId: site.id,
      role: 'industry',
      login: site.siteCode,
      siteId: site.siteCode,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '8h' }
  );

  return res.json({
    token,
    user: {
      id: site.id,
      name: site.name,
      role: 'industry',
      login: site.siteCode,
      siteId: site.siteCode,
      email: site.email || '',
      mobile: site.phone || '',
    },
  });
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

    if (role === 'industry') {
      return await authenticateSite(login, password, res);
    }

    const user = await User.findOne({
      where: { login: String(login).toLowerCase().trim() },
    });

    if (!user) {
      // If role was not explicitly admin/engineer/sales, attempt site authentication as fallback
      if (!role) {
        return await authenticateSite(login, password, res);
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

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

const auth = require('../../middleware/auth');

/* ------------------------------------------------------------
   GET /api/portal/auth/users
   List all portal accounts (admin only)
   ------------------------------------------------------------ */
router.get('/users', auth('admin'), async (req, res, next) => {
  try {
    const list = await User.findAll({
      order: [['id', 'ASC']],
    });
    res.json(list.map(toUserJSON));
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------
   POST /api/portal/auth/users
   Create engineer or user account (admin only)
   ------------------------------------------------------------ */
router.post('/users', auth('admin'), async (req, res, next) => {
  try {
    const { name, login, password, mobile, email, role = 'engineer', siteId } = req.body;
    if (!name || !login || !password) {
      return res.status(400).json({ error: 'Name, login, and password are required' });
    }

    const cleanLogin = String(login).toLowerCase().trim();
    if (cleanLogin.length < 3) {
      return res.status(400).json({ error: 'Login username must be at least 3 characters' });
    }

    if (String(password).length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const existing = await User.findOne({ where: { login: cleanLogin } });
    if (existing) {
      return res.status(409).json({ error: `Login username "${cleanLogin}" already exists.` });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name.trim(),
      role: role || 'engineer',
      login: cleanLogin,
      passwordHash,
      mobile: (mobile || '').trim(),
      email: (email || '').trim(),
      siteCode: siteId || null,
    });

    res.status(201).json(toUserJSON(user));
  } catch (e) {
    if (e.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Login username already exists' });
    }
    next(e);
  }
});

/* ------------------------------------------------------------
   PUT /api/portal/auth/users/:id/password
   Update/reset password for a user/engineer (admin only)
   ------------------------------------------------------------ */
router.put('/users/:id/password', auth('admin'), async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters' });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordHash = passwordHash;
    await user.save();

    res.json({ ok: true, message: `Password updated successfully for ${user.login}` });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------
   DELETE /api/portal/auth/users/:id
   Delete user account (admin only)
   ------------------------------------------------------------ */
router.delete('/users/:id', auth('admin'), async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role === 'admin' || user.login === 'admin') {
      return res.status(400).json({ error: 'Cannot delete primary admin account' });
    }

    await user.destroy();
    res.json({ ok: true, message: `User account "${user.login}" deleted` });
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