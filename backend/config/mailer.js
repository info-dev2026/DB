const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

/* -----------------------------------------------------------------
   SMTP transporter — created once and reused.
   Uses Gmail SMTP by default (smtp.gmail.com:587 with an app password).
   ----------------------------------------------------------------- */
function getTransportOptions() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = (process.env.SMTP_USER || '').trim();
  // Strip spaces if user pasted a 16-char Google App Password like "abcd efgh ijkl mnop"
  const pass = (process.env.SMTP_PASS || '').trim().replace(/\s+/g, '');

  return {
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  };
}

const transporter = nodemailer.createTransport(getTransportOptions());

/* Optional: verify the connection on boot */
async function verifyMailer() {
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();

  if (!user || !pass || user === 'your_email@gmail.com' || pass === 'your_16_char_app_password') {
    logger.warn('⚠️  SMTP credentials not configured in backend/.env — offline alert emails will be skipped. Please set valid SMTP_USER and SMTP_PASS.');
    return false;
  }
  try {
    const t = nodemailer.createTransport(getTransportOptions());
    await t.verify();
    logger.info(`✅ SMTP connection verified (${process.env.SMTP_HOST || 'smtp.gmail.com'} as ${user})`);
    return true;
  } catch (e) {
    logger.warn('⚠️  SMTP connection failed: ' + e.message);
    return false;
  }
}

module.exports = transporter;
module.exports.getTransportOptions = getTransportOptions;
module.exports.verifyMailer = verifyMailer;