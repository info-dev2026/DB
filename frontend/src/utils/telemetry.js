/* ============================================================
   utils/telemetry.js
   Telemetry & Last Data Received calculation helpers
   Supports both live ISO timestamps and relative strings.
   Complies with CPCB 15-minute telemetry monitoring rules.
   ============================================================ */

import { fmtTime, fmtConfiguredDate } from './formatters';

/**
 * Parse strings like "just now", "4h 12m ago", "15m ago" into elapsed minutes.
 */
export function parseLastDataToMinutes(str) {
  if (!str || typeof str !== 'string') return 0;
  if (str.includes('just now')) return 0;
  let total = 0;
  const hMatch = str.match(/(\d+)\s*h/);
  if (hMatch) total += parseInt(hMatch[1], 10) * 60;
  const mMatch = str.match(/(\d+)\s*m/);
  if (mMatch) total += parseInt(mMatch[1], 10);
  const dMatch = str.match(/(\d+)\s*d/);
  if (dMatch) total += parseInt(dMatch[1], 10) * 1440;
  return total || 0;
}

/**
 * Format relative elapsed time into clean, user-friendly text.
 */
export function formatRelativeTime(elapsedMinutes) {
  if (elapsedMinutes <= 1) return 'just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const hrs = Math.floor(elapsedMinutes / 60);
  const mins = elapsedMinutes % 60;
  if (elapsedMinutes < 1440) {
    return mins > 0 ? `${hrs}h ${mins}m ago` : `${hrs}h ago`;
  }
  const days = Math.floor(elapsedMinutes / 1440);
  return `${days}d ago`;
}

/**
 * Get comprehensive telemetry information for a single parameter.
 * Evaluates individual param timestamp, connection counters, and site status.
 *
 * @param {object} param - The parameter object (key, name, value, updatedAt, lastData, connHrs, signal)
 * @param {object} [site] - The parent site object (lastData, lastSeenAt, connectivity, signal, etc.)
 * @param {number|Date} [now] - Current timestamp (defaults to Date.now())
 */
export function getParamTelemetry(param, site = {}, now = Date.now()) {
  const currentMs = typeof now === 'number' ? now : new Date(now).getTime();

  let dateObj = null;
  const rawTs = param?.updatedAt || param?.lastSeenAt;

  if (rawTs) {
    const parsed = new Date(rawTs);
    if (!isNaN(parsed.getTime())) {
      dateObj = parsed;
    }
  }

  // Check if any telemetry data has ever been received on this specific parameter
  const hasParamValue =
    param?.value != null &&
    param?.value !== '' &&
    param?.value !== 'NA' &&
    param?.value !== 'N/A' &&
    param?.hasReceivedData !== false;

  const hasParamHistory = Array.isArray(param?.history) && param.history.length > 0;
  const hasParamTimestamp = Boolean(param?.updatedAt);
  const hasParamLastData = Boolean(param?.lastData && param.lastData !== 'No data' && param.lastData !== '—');

  const hasAnyData = hasParamValue && (hasParamHistory || hasParamTimestamp || hasParamLastData);

  // Fallback to site-level last seen ONLY if this parameter has actually received data
  if (!dateObj && hasAnyData && site?.lastSeenAt) {
    const parsed = new Date(site.lastSeenAt);
    if (!isNaN(parsed.getTime())) {
      dateObj = parsed;
    }
  }

  // Calculate elapsed minutes
  let elapsedMinutes = 0;
  if (!hasAnyData) {
    elapsedMinutes = 999999;
    dateObj = null;
  } else if (dateObj) {
    elapsedMinutes = Math.max(0, Math.floor((currentMs - dateObj.getTime()) / 60000));
  } else if (param?.connHrs && param.connHrs > 0) {
    elapsedMinutes = Math.round(param.connHrs * 60);
    dateObj = new Date(currentMs - elapsedMinutes * 60000);
  } else if (param?.lastData && param.lastData !== 'No data' && param.lastData !== '—') {
    elapsedMinutes = parseLastDataToMinutes(param.lastData);
    dateObj = new Date(currentMs - elapsedMinutes * 60000);
  } else {
    elapsedMinutes = 0;
    dateObj = new Date(currentMs);
  }

  // Determine freshness & health status based on CPCB OCEMS telemetry standards:
  // - Within 15 minutes: Fresh / Active Transmission (Green)
  // - 15m to 240m (4h): Delayed Transmission (Yellow/Amber)
  // - > 240m (4h), disconnected, or no data: Stale / Offline (Red/Grey)
  const isOffline =
    !hasAnyData ||
    param?.signal === 'grey' ||
    param?.connHrs >= 4 ||
    site?.connectivity === 'grey' ||
    site?.signal === 'grey' ||
    site?.running === false ||
    site?.enabled === false ||
    elapsedMinutes >= 240;

  const isDelayed =
    !isOffline &&
    (param?.signal === 'delay' ||
      site?.connectivity === 'delay' ||
      (param?.connHrs > 0 && param?.connHrs < 4) ||
      elapsedMinutes >= 15);

  let status = 'live';
  let statusText = 'Live / Fresh';
  let badgeColor = 'var(--st-green, #10b981)';
  let bgSoft = 'rgba(16, 185, 129, 0.12)';
  let borderColor = 'rgba(16, 185, 129, 0.3)';

  if (isOffline) {
    status = 'offline';
    statusText = !hasAnyData
      ? 'No Data'
      : elapsedMinutes >= 60
      ? `Offline (${Math.floor(elapsedMinutes / 60)}h)`
      : 'Offline';
    badgeColor = 'var(--st-grey, #64748b)';
    bgSoft = 'rgba(100, 116, 139, 0.12)';
    borderColor = 'rgba(100, 116, 139, 0.3)';
  } else if (isDelayed) {
    status = 'delayed';
    statusText = elapsedMinutes >= 60 ? `Delayed (${Math.floor(elapsedMinutes / 60)}h)` : `Delayed (${elapsedMinutes}m)`;
    badgeColor = 'var(--st-yellow, #f59e0b)';
    bgSoft = 'rgba(245, 158, 11, 0.12)';
    borderColor = 'rgba(245, 158, 11, 0.3)';
  }

  const timeAgoStr = !hasAnyData ? 'No data' : formatRelativeTime(elapsedMinutes);
  const formattedTime = dateObj ? fmtTime(dateObj) : '—';
  const formattedFullDate = dateObj ? fmtConfiguredDate(dateObj) : '—';

  // Freshness bar percentage (100% = 0 min, 0% = 15+ min)
  const freshnessPercent = Math.max(0, Math.min(100, Math.round(100 - (elapsedMinutes / 15) * 100)));

  return {
    dateObj,
    formattedTime,
    formattedFullDate,
    timeAgoStr,
    elapsedMinutes,
    status,
    statusText,
    badgeColor,
    bgSoft,
    borderColor,
    freshnessPercent,
    isFresh: status === 'live',
    isDelayed: status === 'delayed',
    isOffline: status === 'offline',
  };
}

/**
 * Aggregate telemetry summary across all parameters of a site.
 */
export function getSiteTelemetrySummary(site, now = Date.now()) {
  const params = site?.params || [];
  let liveCount = 0;
  let delayedCount = 0;
  let offlineCount = 0;

  params.forEach((p) => {
    const t = getParamTelemetry(p, site, now);
    if (t.status === 'live') liveCount++;
    else if (t.status === 'delayed') delayedCount++;
    else offlineCount++;
  });

  const siteLastData = site?.lastData || 'just now';
  const elapsedMinutes = parseLastDataToMinutes(siteLastData);

  let siteTimeAgo = formatRelativeTime(elapsedMinutes);
  let siteDateObj = site?.lastSeenAt ? new Date(site?.lastSeenAt) : new Date(now - elapsedMinutes * 60000);
  let siteFormattedTime = fmtTime(siteDateObj);

  return {
    totalParams: params.length,
    liveCount,
    delayedCount,
    offlineCount,
    siteTimeAgo,
    siteFormattedTime,
    siteDateObj,
    isAllLive: liveCount === params.length && params.length > 0,
    hasWarnings: delayedCount > 0 || offlineCount > 0,
  };
}
