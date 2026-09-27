import { useState, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { SIG_LABEL, ACTIONS } from '../utils/cpcb';
import { fmtDate } from '../utils/formatters';
import Panel from '../components/UI/Panel';

const FILTERS = [
  ['all', 'All'],
  ['red', 'Exceedance'],
  ['orange', 'Orange'],
  ['yellow', 'Warning'],
  ['purple', 'Critical'],
  ['grey', 'Offline'],
];

export default function Alerts({ mine = false }) {
  const { alerts, sites } = useData();
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
    return visible.filter((a) => (a.level || a.signal) === filter);
  }, [visible, filter]);

  /* ---- Counts for chips ---- */
  const counts = useMemo(() => {
    const c = { all: visible.length, red: 0, orange: 0, yellow: 0, purple: 0, grey: 0 };
    visible.forEach((a) => {
      const lvl = a.level || a.signal;
      if (c[lvl] != null) c[lvl]++;
    });
    return c;
  }, [visible]);

  /* ---- Header subtitle ---- */
  const subtitle = mine
    ? (mySite
        ? `${visible.length} alerts · ${mySite.name} (${mySite.id})`
        : 'No site linked to this login.')
    : (counts.red > 0
        ? `${visible.length} total · ${counts.red} active exceedance${counts.red > 1 ? 's' : ''}`
        : `${visible.length} total`);

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
                      opacity: 0.7,
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
        }
        body="flush"
      >
        {list.length === 0 ? (
          <div className="empty">
            {filter === 'all'
              ? mine
                ? 'No alerts for your site. All clear.'
                : 'All clear. No alerts at this time.'
              : `No ${SIG_LABEL[filter]} alerts.`}
          </div>
        ) : (
          list.slice(0, 100).map((a) => {
            const level = a.level || a.signal || 'grey';
            const ts = a.time || a.ts || Date.now();
            return (
              <div key={a.id} className={'alert-row ' + level}>
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
                          {a.param}
                        </span>
                      </>
                    )}

                    {/* For industry: show param name + site code */}
                    {mine && (
                      <>
                        <b>{a.param}</b>
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
              </div>
            );
          })
        )}
      </Panel>
    </>
  );
}