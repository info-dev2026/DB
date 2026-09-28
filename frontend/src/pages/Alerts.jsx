import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { SIG_LABEL, ACTIONS } from '../utils/cpcb';
import { fmtDate } from '../utils/formatters';
import Panel from '../components/UI/Panel';

const FILTERS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['red', 'Exceedance'],
  ['orange', 'Orange'],
  ['yellow', 'Warning'],
  ['purple', 'Critical'],
  ['grey', 'Offline'],
];

export default function Alerts({ mine = false }) {
  const { alerts, sites, ackAlert, ackAllAlerts } = useData();
  const { session } = useAuth();
  const [filter, setFilter] = useState('all');

  /* ---- If industry user: restrict to their own site ---- */
  const mySite = mine
    ? sites.find((s) => s.id === session?.siteId)
    : null;

  const visible = useMemo(() => {
    if (!mine) return alerts;
    if (!mySite) return [];
    return alerts.filter((a) => a.siteId === mySite.id);
  }, [alerts, mine, mySite]);

  /* ---- Apply filter chip ---- */
  const list = useMemo(() => {
    if (filter === 'all') return visible;
    if (filter === 'unread') return visible.filter((a) => !a.acknowledged);
    return visible.filter((a) => (a.level || a.signal) === filter);
  }, [visible, filter]);

  /* ---- Counts for chips ---- */
  const counts = useMemo(() => {
    const c = { all: visible.length, unread: 0, red: 0, orange: 0, yellow: 0, purple: 0, grey: 0 };
    visible.forEach((a) => {
      if (!a.acknowledged) c.unread++;
      const lvl = a.level || a.signal;
      if (c[lvl] != null) c[lvl]++;
    });
    return c;
  }, [visible]);

  /* ---- Header subtitle ---- */
  const subtitle = mine
    ? (mySite
        ? `${visible.length} alerts (${counts.unread} unread) · ${mySite.name} (${mySite.id})`
        : 'No site linked to this login.')
    : (counts.red > 0
        ? `${visible.length} total · ${counts.unread} unread · ${counts.red} active exceedance${counts.red > 1 ? 's' : ''}`
        : `${visible.length} total · ${counts.unread} unread`);

  const getAlertParamLabel = (siteCode, paramKey) => {
    const s = sites.find((x) => x.id === siteCode || x.siteCode === siteCode);
    const p = s?.params?.find((x) => x.key === paramKey);
    return p?.name || paramKey;
  };

  const handleMarkAsRead = async (a, e) => {
    if (e) e.stopPropagation();
    const alertId = a.id || a._id;
    try {
      await ackAlert(alertId);
      toast.success('Alert marked as read');
    } catch {
      toast.error('Failed to mark alert as read');
    }
  };

  const handleMarkAllRead = async () => {
    if (counts.unread === 0) return;
    try {
      await ackAllAlerts(mine && mySite ? mySite.id : null);
      toast.success('All alerts marked as read');
    } catch {
      toast.error('Failed to mark all as read');
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Alert Log</div>
          <div className="page-sub">
            <span>{subtitle}</span>
          </div>
        </div>
      </div>

      <Panel
        title={mine ? 'My Site Alerts' : 'Automated Alerts'}
        hint="CPCB grading · newest first"
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {counts.unread > 0 && (
              <button
                className="btn-mark-all"
                onClick={handleMarkAllRead}
                title="Mark all unread alerts as read"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                  <polyline points="15 6 9 12" />
                </svg>
                <span>Mark all as read ({counts.unread})</span>
              </button>
            )}
            <div className="chips">
              {FILTERS.map(([f, l]) => (
                <button
                  key={f}
                  className={'chip' + (filter === f ? ' on' : '')}
                  onClick={() => setFilter(f)}
                >
                  {l}
                  {counts[f] != null && counts[f] > 0 && (
                    <span
                      style={{
                        marginLeft: 4,
                        opacity: f === 'unread' ? 1 : 0.7,
                        fontWeight: f === 'unread' ? 700 : 'normal',
                        color: f === 'unread' ? 'var(--st-red)' : 'inherit',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                      }}
                    >
                      {counts[f]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        }
        body="flush"
      >
        {list.length === 0 ? (
          <div className="empty">
            {filter === 'all'
              ? mine
                ? 'No alerts for your site. All clear.'
                : 'All clear. No alerts at this time.'
              : filter === 'unread'
                ? 'No unread alerts. You are all caught up!'
                : `No ${SIG_LABEL[filter] || filter} alerts.`}
          </div>
        ) : (
          list.slice(0, 100).map((a) => {
            const level = a.level || a.signal || 'grey';
            const ts = a.time || a.ts || Date.now();
            const pLabel = getAlertParamLabel(a.siteId, a.param);
            const alertKey = a.id || a._id;
            const isRead = !!a.acknowledged;

            return (
              <div
                key={alertKey}
                className={'alert-row ' + level + (isRead ? ' read' : ' unread')}
              >
                <div className="arail"></div>
                <div className="abody">
                  <div className="atitle">
                    <span className={'status-dot ' + level}></span>

                    {/* For admin/engineer/sales: show site name + param */}
                    {!mine && (
                      <>
                        <b>{a.site}</b>
                        <span
                          style={{
                            color: 'var(--ink-3)',
                            fontSize: 12,
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {pLabel}
                        </span>
                      </>
                    )}

                    {/* For industry: show param name + site code */}
                    {mine && (
                      <>
                        <b>{pLabel}</b>
                        <span
                          style={{
                            color: 'var(--ink-3)',
                            fontSize: 12,
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {mySite?.id}
                        </span>
                      </>
                    )}

                    <span className="atime">{fmtDate(ts)}</span>
                  </div>

                  <div className="asub">{a.reason}</div>

                  {ACTIONS[level] && (
                    <div
                      className="ameta"
                      style={{ fontFamily: 'inherit', color: 'var(--ink-3)' }}
                    >
                      {ACTIONS[level]}
                    </div>
                  )}
                </div>

                <div className="a-actions">
                  {!isRead ? (
                    <button
                      className="btn-mark-read"
                      onClick={(e) => handleMarkAsRead(a, e)}
                      title="Mark this alert as read"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>Mark as read</span>
                    </button>
                  ) : (
                    <span
                      className="ack-tag"
                      title={a.ackBy ? `Read by ${a.ackBy}${a.ackAt ? ' at ' + fmtDate(a.ackAt) : ''}` : 'Read'}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>Read</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </Panel>
    </>
  );
}