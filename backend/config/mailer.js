const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

/* -----------------------------------------------------------------
   SMTP transporter — created once and reused.
   Uses Gmail SMTP by default (smtp.gmail.com:587 with an app password).
   ----------------------------------------------------------------- */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/* Optional: verify the connection on boot (skipped if no credentials) */
async function verifyMailer() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.warn('⚠️  SMTP credentials not set — emails will be skipped');
    return false;
  }
  try {
    await transporter.verify();
    logger.info('✅ SMTP connection verified');
    return true;
  } catch (e) {
    logger.warn('⚠️  SMTP connection failed: ' + e.message);
    return false;
  }
}

module.exports = transporter;
module.exports.verifyMailer = verifyMailer;