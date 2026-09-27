import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { HEX, PARAMS, SIG_LABEL, triggerReason } from '../utils/cpcb';
import { siteServiceAlert } from '../utils/serviceHelpers';
import Panel from '../components/UI/Panel';
import TrendLine from '../components/Charts/TrendLine';
import EngineerCard from '../components/UI/EngineerCard';

export default function MySite() {
  const { session } = useAuth();
  const { sites } = useData();
  const navigate = useNavigate();

  const site = sites.find((s) => s.id === session?.siteId);

  if (!site) {
    return <div className="empty">No site linked to this login.</div>;
  }

  const alert = siteServiceAlert(site);

  const openSupport = () =>
    window.dispatchEvent(new CustomEvent('open-support'));

  return (
    <>
      {/* Page header */}
      <div className="page-head">
        <div>
          <div className="page-title">{site.name}</div>
          <div className="page-sub">
            <span className="live-dot"></span>
            <span className="mono">{site.id}</span>
            <span>·</span>
            <span>{site.sector || '—'}</span>
            <span>·</span>
            <span>{site.loc || '—'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="status-pill" style={{ paddingRight: 12 }}>
            <span className={'status-dot ' + site.signal}></span>
            {SIG_LABEL[site.signal]}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/reports')}>
            ⬇ Report
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/myservices')}
          >
            ◷ Services
          </button>
          <button className="btn btn-primary btn-sm" onClick={openSupport}>
            ⚠ Raise Complaint
          </button>
        </div>
      </div>

      {/* Service expiry banner */}
      {alert && ['expired', 'week', 'd15', 'm1', 'm2'].includes(alert.code) && (
        <div
          className="service-banner"
          style={{ borderLeftColor: alert.hex }}
        >
          <span className="badge" style={{ background: alert.hex }}>
            {alert.label}
          </span>
          <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            <b style={{ color: 'var(--ink)' }}>
              {alert.type}
              {alert.equip !== '—' ? ' · ' + alert.equip : ''}
            </b>{' '}
            {alert.days < 0
              ? 'expired ' + Math.abs(alert.days) + ' days ago'
              : 'expires in ' + alert.days + ' days'}
            .
          </div>
          <button
            className={'btn btn-sm ' + (alert.code === 'm2' ? 'btn-primary' : 'btn-danger')}
            style={{ marginLeft: 'auto' }}
            onClick={() => navigate('/myservices')}
          >
            Renew now
          </button>
        </div>
      )}

      {/* Live gauges — one per parameter, using custom name */}
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
              <div className="gp" title={p.key}>
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
        hint="Last 24 readings"
      >
        <TrendLine site={site} />
      </Panel>

      {/* Grading counters */}
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
                <th>Key</th>
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
                  <td className="mono">{p.pid || '—'}</td>
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

      {/* Engineer */}
      <Panel title="Need help?">
        <EngineerCard />
      </Panel>
    </>
  );
}