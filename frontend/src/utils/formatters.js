/* ========== Date / number / text formatters ========== */

export const fmtTime = (d) =>
  new Date(d).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

export const fmtDate = (t) =>
  new Date(t).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

export const fmtDay = (t) =>
  new Date(t).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

export const timeAgo = (t) => {
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};

export const addMonths = (ts, m) => {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + m);
  return d.getTime();
};

export const fmtRupees = (n) => '₹' + (n || 0).toLocaleString('en-IN');

export const rid = () =>
  Math.random().toString(36).slice(2, 8).toUpperCase();