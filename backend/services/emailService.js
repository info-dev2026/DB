/* ============================================================
   services/emailService.js
   Sends alert & offline emails to site notifyEmails and global alert recipients.
   ============================================================ */

const transporter = require('../config/mailer');
const logger = require('../utils/logger');

const PLACEHOLDER_EMAILS = new Set([
  'your_email@gmail.com',
  'your_email@example.com',
  'your_16_char_app_password',
  'email@example.com',
  'test@example.com',
]);

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const cleaned = email.trim().toLowerCase();
  if (PLACEHOLDER_EMAILS.has(cleaned)) return false;
  if (cleaned.endsWith('@example.com') || cleaned.endsWith('@example.org')) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned);
}

function getFromAddress() {
  const mailFrom = process.env.MAIL_FROM;
  if (mailFrom && !mailFrom.includes('your_email@gmail.com')) {
    return mailFrom;
  }
  const smtpUser = (process.env.SMTP_USER || '').trim();
  if (smtpUser && isValidEmail(smtpUser)) {
    return `Saaphzone OCEMS <${smtpUser}>`;
  }
  return 'Saaphzone OCEMS <alerts@saaphzone.com>';
}

function hasConfiguredSmtp() {
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  return !!(user && pass && user !== 'your_email@gmail.com' && pass !== 'your_16_char_app_password');
}

/* ------------------------------------------------------------
   Resolve recipients for a site.
   - Collects site.notifyEmails (per-site list)
   - Fallback to site.email (primary contact email)
   - Fallback to site.phone if it contains an email address
   - Collects global ALERT_RECIPIENTS / ADMIN_EMAIL from .env
   - Deduplicates and filters out placeholders and invalid addresses
   ------------------------------------------------------------ */
function resolveRecipients(site) {
  const result = new Set();

  if (site) {
    // 1. Per-site notifyEmails
    const list = Array.isArray(site.notifyEmails)
      ? site.notifyEmails
      : (typeof site.notifyEmails === 'string' ? site.notifyEmails.split(/[,\s;]+/) : []);

    for (const item of list) {
      const e = String(item || '').trim().toLowerCase();
      if (isValidEmail(e)) result.add(e);
    }

    // 2. Site contact email
    if (site.email) {
      for (const item of String(site.email).split(/[,\s;]+/)) {
        const e = item.trim().toLowerCase();
        if (isValidEmail(e)) result.add(e);
      }
    }

    // 3. Site phone field (if user typed an email into contact field)
    if (site.phone && site.phone.includes('@')) {
      for (const item of String(site.phone).split(/[,\s;]+/)) {
        const e = item.trim().toLowerCase();
        if (isValidEmail(e)) result.add(e);
      }
    }
  }

  // 4. Global alert recipients from environment
  const envRecipients = [
    ...(process.env.ALERT_RECIPIENTS ? process.env.ALERT_RECIPIENTS.split(/[,\s;]+/) : []),
    ...(process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL.split(/[,\s;]+/) : []),
  ];

  for (const item of envRecipients) {
    const e = item.trim().toLowerCase();
    if (isValidEmail(e)) result.add(e);
  }

  // 5. If still no recipients found, fallback to SMTP_USER if it is a real address
  if (result.size === 0) {
    const fallback = (process.env.SMTP_USER || '').trim().toLowerCase();
    if (isValidEmail(fallback)) {
      result.add(fallback);
    }
  }

  return Array.from(result);
}

/* ============================================================
   Device offline email
   ============================================================ */
async function sendDeviceOfflineEmail({ site, minutesOffline, lastSeen }) {
  const recipients = resolveRecipients(site);
  if (!recipients.length) {
    logger.warn(
      `⚠️ No alert recipients found for offline site ${site?.id || '?'} — skipping email (set site.notifyEmails or ALERT_RECIPIENTS in .env)`
    );
    return false;
  }

  if (!hasConfiguredSmtp()) {
    logger.warn(
      `⚠️ Cannot send offline email for site ${site?.id || '?'}: SMTP credentials in backend/.env are placeholder/missing (SMTP_USER: ${process.env.SMTP_USER || 'empty'}). Please set valid credentials.`
    );
    return false;
  }

  const subject = `⚠️ [OCEMS] Device OFFLINE — ${site.name} (${site.id})`;

  const paramList = (site.params || [])
    .map((p) => {
      const val = p.value === null || p.value === undefined || p.value === 'NA' || Number.isNaN(Number(p.value))
        ? 'NA'
        : p.value;
      return `<li><b>${p.key}</b>: ${val} ${p.unit || ''}</li>`;
    })
    .join('');

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
      <div style="background:#0f766e;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
        <h2 style="margin:0;font-size:18px;letter-spacing:-0.02em">🚨 Saaphzone OCEMS — Device Offline Alert</h2>
      </div>
      <div style="border:1px solid #dde3e4;border-top:none;padding:22px;border-radius:0 0 10px 10px;background:#ffffff">
        <p style="margin:0 0 14px;font-size:15px;line-height:1.5">
          Station <b>${site.name}</b> (<code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${site.id}</code>) has not transmitted telemetry data for
          <b style="color:#dc2626;font-size:16px">${minutesOffline} minutes</b>.
        </p>
        <table style="width:100%;font-size:13px;color:#475569;border-collapse:collapse;margin:12px 0 16px">
          <tr><td style="padding:6px 12px 6px 0;width:120px;font-weight:600">Station / Type</td><td>${site.deviceType || 'Analyzer'}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;font-weight:600">Sector</td><td>${site.sector || '—'}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;font-weight:600">Location</td><td>${site.loc || '—'}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;font-weight:600">SPCB Authority</td><td>${site.spcb || '—'}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;font-weight:600">Last Seen</td><td style="color:#0f172a;font-weight:500">${lastSeen ? new Date(lastSeen).toLocaleString('en-IN') : '—'}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;font-weight:600">Contact</td><td>${site.contact || '—'} · ${site.phone || site.email || '—'}</td></tr>
        </table>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin:14px 0">
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#0f172a">Last known parameter values:</p>
          <ul style="margin:0;padding-left:20px;font-size:13px;color:#334155;line-height:1.6">
            ${paramList || '<li>No telemetry parameters configured</li>'}
          </ul>
        </div>
        <p style="margin:18px 0 0;font-size:12px;color:#64748b;line-height:1.5">
          ⚠️ <b>Action Required:</b> Please check site power, modem connectivity, RS485 communication, or data diverter script.<br>
          <i>Under CPCB/SPCB guidelines, continuous data outages exceeding 4 hours require formal incident logging.</i>
          <br><br>— Automated alert via Saaphzone OCEMS Device Monitor
        </p>
      </div>
    </div>`;

  try {
    const fromAddr = getFromAddress();
    await transporter.sendMail({
      from: fromAddr,
      to: recipients.join(', '),
      subject,
      html,
    });
    logger.info(`📧 Offline email sent for site ${site.id} → ${recipients.join(', ')}`);
    return true;
  } catch (e) {
    logger.error(`❌ Failed to send offline email for ${site.id}: ` + e.message);
    return false;
  }
}

/* ============================================================
   Device recovery email
   ============================================================ */
async function sendRecoveryEmail({ site, minutesOffline }) {
  const recipients = resolveRecipients(site);
  if (!recipients.length || !hasConfiguredSmtp()) return false;

  const subject = `✅ [OCEMS] Device RECOVERED — ${site.name} (${site.id})`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
      <div style="background:#16a34a;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">
        <h2 style="margin:0;font-size:18px">✅ Saaphzone OCEMS — Device Recovered</h2>
      </div>
      <div style="border:1px solid #dde3e4;border-top:none;padding:20px;border-radius:0 0 10px 10px;background:#ffffff">
        <p style="margin:0 0 12px;font-size:14px">Station <b>${site.name}</b> (${site.id}) is back online after
          <b>${minutesOffline} minutes</b> offline.</p>
        <p style="color:#64748b;font-size:13px;margin:0">Live telemetry data is streaming normally.</p>
        <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">— Saaphzone OCEMS automated monitoring</p>
      </div>
    </div>`;

  try {
    const fromAddr = getFromAddress();
    await transporter.sendMail({
      from: fromAddr,
      to: recipients.join(', '),
      subject,
      html,
    });
    logger.info(`📧 Recovery email sent for ${site.id} → ${recipients.join(', ')}`);
    return true;
  } catch (e) {
    logger.error('Recovery email failed: ' + e.message);
    return false;
  }
}

/* ============================================================
   Generic alert email (used for yellow / orange / red / purple)
   ============================================================ */
async function sendAlertEmail({ site, param, level, reason, value, limit }) {
  const recipients = resolveRecipients(site);
  if (!recipients.length || !hasConfiguredSmtp()) return false;

  const subject = `⚠️ [OCEMS] ${String(level).toUpperCase()} Exceedance — ${site.name} · ${param}`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
      <div style="background:#dc2626;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">
        <h2 style="margin:0;font-size:18px">⚠️ Parameter Exceedance Alert</h2>
      </div>
      <div style="border:1px solid #dde3e4;border-top:none;padding:20px;border-radius:0 0 10px 10px;background:#ffffff">
        <p><b>${site.name}</b> (${site.id})</p>
        <p>Parameter <b>${param}</b> measured at <b>${value}</b> (prescribed limit: ${limit}).</p>
        <p style="color:#64748b">${reason}</p>
        <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">— Saaphzone OCEMS automated monitoring</p>
      </div>
    </div>`;

  try {
    const fromAddr = getFromAddress();
    await transporter.sendMail({
      from: fromAddr,
      to: recipients.join(', '),
      subject,
      html,
    });
    logger.info(`📧 Alert email sent for ${site.id} → ${recipients.join(', ')}`);
    return true;
  } catch (e) {
    logger.error('Alert email failed: ' + e.message);
    return false;
  }
}

/* ============================================================
   Test offline email helper (for verification & diagnostics)
   ============================================================ */
async function sendTestEmail({ to, siteId = null }) {
  if (!hasConfiguredSmtp()) {
    return {
      ok: false,
      error: 'SMTP credentials not configured',
      details: `SMTP_USER is "${process.env.SMTP_USER || 'empty'}". Please configure valid SMTP credentials in backend/.env`,
    };
  }

  const recipientList = to
    ? String(to).split(/[,\s;]+/).map((e) => e.trim().toLowerCase()).filter(isValidEmail)
    : [];

  let finalRecipients = recipientList;
  if (!finalRecipients.length) {
    finalRecipients = resolveRecipients(null);
  }

  if (!finalRecipients.length) {
    return {
      ok: false,
      error: 'No valid recipient email provided and no global ALERT_RECIPIENTS found in .env',
    };
  }

  const sampleSite = {
    id: siteId || 'TEST_001',
    name: 'Sample Station (Test)',
    deviceType: 'Water Analyzer',
    sector: 'Manufacturing',
    loc: 'Industrial Sector 5',
    spcb: 'CPCB / SPCB',
    contact: 'Station In-Charge',
    phone: '+91-9876543210',
    notifyEmails: finalRecipients,
    params: [
      { key: 'COD', value: 45.2, unit: 'mg/L' },
      { key: 'BOD', value: 12.1, unit: 'mg/L' },
      { key: 'TSS', value: 24.0, unit: 'mg/L' },
      { key: 'pH', value: 7.4, unit: 'pH' },
    ],
  };

  const ok = await sendDeviceOfflineEmail({
    site: sampleSite,
    minutesOffline: 5,
    lastSeen: new Date(Date.now() - 5 * 60_000),
  });

  return {
    ok,
    recipients: finalRecipients,
    message: ok ? `Test offline email dispatched successfully to ${finalRecipients.join(', ')}` : 'Failed to send test email (check server logs for details)',
  };
}

module.exports = {
  sendDeviceOfflineEmail,
  sendRecoveryEmail,
  sendAlertEmail,
  sendTestEmail,
  resolveRecipients,
  hasConfiguredSmtp,
};