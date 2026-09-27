import { useParams, useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { HEX, PARAMS, SIG_LABEL, triggerReason, pidFor } from '../utils/cpcb';
import Panel from '../components/UI/Panel';
import TrendLine from '../components/Charts/TrendLine';

export default function SiteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { sites } = useData();

  const site = sites.find((s) => s.id === id);

  if (!site) return <div className="empty">Site not found.</div>;

  const back = () => {
    if (session?.role === 'industry') navigate('/mysite');
    else navigate(-1);
  };

  const flagged = site.params.filter((p) =>
    ['yellow', 'orange', 'red', 'purple'].includes(p.signal)
  ).length;

  return (
    <>
      <div className="back-btn" onClick={back}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </div>

      {/* Header */}
      <div className="detail-head">
        <div>
          <div className="dh-name">{site.name}</div>
          <div className="dh-meta">
            <span className="mono">{site.id}</span>
            <span>·</span>
            <span>{site.sector || '—'}</span>
            <span>·</span>
            <span>{site.loc || '—'}</span>
            <span>·</span>
            <span>{site.spcb || '—'}</span>
            {site.ganga && (
              <span className="badge" style={{ background: 'var(--accent)' }}>
                GPI Ganga
              </span>
            )}
          </div>
          <div className="dh-meta">
            <span>
              <b style={{ color: 'var(--ink-2)', fontWeight: 500 }}>Contact:</b>{' '}
              {site.contact || '—'}
            </span>
            <span>{site.phone || '—'}</span>
            <span>
              {site.stacks || 0} stack · {site.etp || 0} ETP
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!site.enabled && <span className="badge grey">Hidden</span>}
          {!site.running && <span className="badge grey">Stopped</span>}
          <span className="status-pill" style={{ fontSize: 14 }}>
            <span className={'status-dot ' + site.signal}></span>
            {SIG_LABEL[site.signal]}
          </span>
        </div>
      </div>

      {/* Live gauges — using custom name */}
      <div className="gauge-row">
        {site.params.map((p, idx) => {
          const def = PARAMS[p.key] || {};
          const col = HEX[p.signal];
          const pct = Math.min(
            100,
            (p.value / ((p.limit || def.limit || 100) * 1.6)) * 100
          );
          const displayName = p.name || p.key;

          return (
            <div className="gauge" key={p.pid || p.key + '-' + idx}>
              <div className="gp" title={p.key + ' · ' + (p.pid || '')}>
                {displayName}
              </div>
              <div className="gv">
                {p.value}
                <span className="gu">{p.unit || def.unit || ''}</span>
              </div>
              <div className="glim">
                Limit{' '}
                {def.ph
                  ? (def.min ?? 6.5) + '–' + (p.limit || def.limit)
                  : '≤ ' + (p.limit || def.limit) + ' ' + (p.unit || def.unit || '')}
              </div>
              <div className="gbar">
                <i style={{ width: pct + '%', background: col }}></i>
              </div>
              <div
                className="glim"
                style={{ color: col, fontWeight: 500, marginTop: 8 }}
              >
                {triggerReason(p)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Trend */}
      <Panel
        title="15-min Averaged Trends"
        hint={
          flagged > 0
            ? flagged + ' parameter' + (flagged > 1 ? 's' : '') + ' flagged'
            : 'All parameters within limits'
        }
      >
        <TrendLine site={site} />
      </Panel>

      {/* Grading counters table — Name first, then Key */}
      <Panel
        title="CPCB Grading Counters"
        hint="Rolling values driving alerts"
        body="flush"
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Param ID</th>
                <th>Name</th>
                <th>Type</th>
                <th>Now</th>
                <th>Exc today</th>
                <th>Warn/30d</th>
                <th>Conn-fail</th>
                <th>Frozen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {site.params.map((p, idx) => (
                <tr key={p.pid || p.key + '-' + idx}>
                  <td className="mono">{p.pid || pidFor(site.id, p.key)}</td>
                  <td>
                    <b>{p.name || p.key}</b>
                  </td>
                  <td className="mono">{p.key}</td>
                  <td
                    className={
                      'mono ' +
                      (['yellow', 'orange', 'red', 'purple'].includes(p.signal)
                        ? 'val-exc'
                        : '')
                    }
                  >
                    {p.value} {p.unit || ''}
                  </td>
                  <td className="mono">{p.yToday || 0}</td>
                  <td className="mono">{p.y30 || 0}</td>
                  <td className="mono">{p.connHrs || 0}h</td>
                  <td className="mono">{Math.round(p.stableHrs || 0)}h</td>
                  <td>
                    <span className="status-pill">
                      <span className={'status-dot ' + p.signal}></span>
                      {SIG_LABEL[p.signal]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}