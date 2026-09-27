const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/sites', require('./sites.routes'));
router.use('/alerts', require('./alerts.routes'));
router.use('/complaints', require('./complaints.routes'));
router.use('/services', require('./services.routes'));
router.use('/reports', require('./reports.routes'));

module.exports = router;