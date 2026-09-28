/* ============================================================
   routes/portal/keys.routes.js

   Manage portal API keys and per-site logger keys.

   GET    /api/portal/keys/me                  → current user's portal key
   POST   /api/portal/keys/me/regenerate       → generate new portal key
   GET    /api/portal/keys/sites               → list sites + their logger keys
   POST   /api/portal/keys/sites/:id/regenerate → generate new logger key for a site
   ============================================================ */

const router = require('express').Router();
const auth = require('../../middleware/auth');
const { User, Site } = require('../../models');
const {
  generatePortalKey,
  generateLoggerKey,
} = require('../../utils/apiKeys');

/* ------------------------------------------------------------
   GET /api/portal/keys/me
   Returns the current user's portal API key (may be null).
   ------------------------------------------------------------ */
router.get('/me', auth(), async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      login: user.login,
      role: user.role,
      portalKey: user.apiKey || null,
    });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------
   POST /api/portal/keys/me/regenerate
   Generate a fresh portal API key. The old key is invalidated
   immediately. Only admin/engineer can do this.
   ------------------------------------------------------------ */
router.post(
  '/me/regenerate',
  auth(['admin', 'engineer']),
  async (req, res, next) => {
    try {
      const user = await User.findByPk(req.user.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const newKey = generatePortalKey();
      await user.update({ apiKey: newKey });

      res.json({
        login: user.login,
        portalKey: newKey,
        message:
          'Portal API key regenerated. Store it safely — the old key no longer works.',
      });
    } catch (e) {
      next(e);
    }
  }
);

/* ------------------------------------------------------------
   GET /api/portal/keys/sites
   List every site with its logger key and ingest URL.
   ------------------------------------------------------------ */
router.get('/sites', auth(['admin', 'engineer']), async (req, res, next) => {
  try {
    const sites = await Site.findAll({
      attributes: ['siteCode', 'name', 'loggerKey'],
      order: [['siteCode', 'ASC']],
    });

    res.json(
      sites.map((s) => ({
        siteId: s.siteCode,
        name: s.name,
        loggerKey: s.loggerKey || null,
        ingestUrl:
          'https://saaphzone-backend.onrender.com/api/datalogger/readings',
      }))
    );
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------
   POST /api/portal/keys/sites/:id/regenerate
   Generate a new logger key for a specific site.
   ------------------------------------------------------------ */
router.post(
  '/sites/:id/regenerate',
  auth(['admin', 'engineer']),
  async (req, res, next) => {
    try {
      const site = await Site.findOne({ where: { siteCode: req.params.id } });
      if (!site) return res.status(404).json({ error: 'Site not found' });

      const newKey = generateLoggerKey();
      await site.update({ loggerKey: newKey });

      res.json({
        siteId: site.siteCode,
        name: site.name,
        loggerKey: newKey,
        ingestUrl:
          'https://saaphzone-backend.onrender.com/api/datalogger/readings',
        message:
          'Logger key regenerated. Update your device configuration — the old key no longer works.',
      });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;