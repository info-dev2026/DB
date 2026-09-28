/* ============================================================
   services/emailService.js
   Sends alert emails to each site's own notifyEmails list.
   Sites with no notifyEmails are silently skipped.
   ============================================================ */

const transporter = require('../config/mailer');
const logger = require('../utils/logger');

const FROM = process.env.MAIL_FROM || 'Saaphzone OCEMS <alerts@saaphzone.com>';

/* ------------------------------------------------------------
   Resolve recipients for a site.
   - Uses site.notifyEmails if it has entries
   - Otherwise returns [] (no send, no fallback)
   ------------------------------------------------------------ */
function resolveRecipients(site) {
  if (!site) return [];
  const list = Array.isArray(site.notifyEmails) ? site.notifyEmails : [];
  return list
    .map((e) => String(e).trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

/* ============================================================
   Device offline email
   ============================================================ */
async function sendDeviceOfflineEmail({ site, minutesOffline, lastSeen }) {
  const recipients = resolveRecipients(site);
  if (!recipients.length) {
    logger.info(
      `No notifyEmails for site ${site?.id || '?'} — skipping offline email`
    );
    return false;
  }

  const subject = `⚠️ [OCEMS] Device OFFLINE — ${site.name} (${site.id})`;

  const paramList = (site.params || [])
    .map((p) => `<li><b>${p.key}</b>: ${p.value ?? '—'} ${p.unit || ''}</li>`)
    .join('');

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:600px">
      <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">
        <h2 style="margin:0;font-size:18px">Saaphzone OCEMS — Device Offline</h2>
      </div>
      <div style="border:1px solid #dde3e4;border-top:none;padding:20px;border-radius:0 0 10px 10px">
        <p style="margin:0 0 12px"><b>${site.name}</b> (${site.id}) has not sent data for
          <b style="color:#dc2626">${minutesOffline} minutes</b>.</p>
        <table style="font-size:13px;color:#6b7a7d;border-collapse:collapse">
          <tr><td style="padding:4px 10px 4px 0">Sector</td><td>${site.sector || '—'}</td></tr>
          <tr><td style="padding:4px 10px 4px 0">Location</td><td>${site.loc || '—'}</td></tr>
          <tr><td style="padding:4px 10px 4px 0">SPCB</td><td>${site.spcb || '—'}</td></tr>
          <tr><td style="padding:4px 10px 4px 0">Last seen</td><td>${lastSeen ? new Date(lastSeen).toLocaleString('en-IN') : '—'}</td></tr>
          <tr><td style="padding:4px 10px 4px 0">Contact</td><td>${site.contact || '—'} · ${site.phone || '—'}</td></tr>
        </table>
        <p style="margin:16px 0 6px"><b>Last known parameter values:</b></p>
        <ul style="margin:0;padding-left:20px;font-size:13px;color:#0d1b1e">${paramList || '<li>—</li>'}</ul>
        <p style="margin:22px 0 0;font-size:12px;color:#98a5a8">
          Please verify power / internet / GPRS modem at the site.
          Under CPCB rules, data outage &gt; 4 h must be reported to SPCB/CPCB.
          <br><br>— Saaphzone OCEMS automated monitoring
        </p>
      </div>
    </div>`;

  try {
    await transporter.sendMail({
      from: FROM,
      to: recipients.join(','),
      subject,
      html,
    });
    logger.info(`📧 Offline email sent for ${site.id} → ${recipients.join(', ')}`);
    return true;
  } catch (e) {
    logger.error('Email send failed: ' + e.message);
    return false;
  }
}

/* ============================================================
   Device recovery email
   ============================================================ */
async function sendRecoveryEmail({ site, minutesOffline }) {
  const recipients = resolveRecipients(site);
  if (!recipients.length) return false;

  const subject = `✅ [OCEMS] Device RECOVERED — ${site.name} (${site.id})`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:600px">
      <p><b>${site.name}</b> (${site.id}) is back online after
        <b>${minutesOffline} minutes</b> offline.</p>
      <p style="color:#6b7a7d;font-size:13px">Live readings are flowing again.</p>
    </div>`;

  try {
    await transporter.sendMail({
      from: FROM,
      to: recipients.join(','),
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
  if (!recipients.length) return false;

  const subject = `⚠️ [OCEMS] ${String(level).toUpperCase()} — ${site.name} · ${param}`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:600px">
      <h2 style="color:#dc2626">Exceedance alert</h2>
      <p><b>${site.name}</b> (${site.id})</p>
      <p>Parameter <b>${param}</b> is at <b>${value}</b> (limit ${limit}).</p>
      <p style="color:#6b7a7d">${reason}</p>
    </div>`;

  try {
    await transporter.sendMail({
      from: FROM,
      to: recipients.join(','),
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

module.exports = {
  sendDeviceOfflineEmail,
  sendRecoveryEmail,
  sendAlertEmail,
};