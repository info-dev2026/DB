import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { HEX, PARAMS, SIG_LABEL, triggerReason, pidFor } from '../utils/cpcb';
import { getParamTelemetry, getSiteTelemetrySummary } from '../utils/telemetry';
import Panel from '../components/UI/Panel';
import TrendLine from '../components/Charts/TrendLine';
import ParameterTelemetryMonitor from '../components/UI/ParameterTelemetryMonitor';
import toast from 'react-hot-toast';

export default function SiteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { sites, refreshAll } = useData();
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);

  // 10-second ticker to dynamically update elapsed times
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  const site = sites.find((s) => s.id === id);

  if (!site) return <div className="empty">Site not found.</div>;

  const back = () => {
    if (session?.role === 'industry') navigate('/mysite');
    else navigate(-1);
  };

  const flagged = site.params.filter((p) =>
    ['yellow', 'orange', 'red', 'purple'].includes(p.signal)
  ).length;

  const telSummary = getSiteTelemetrySummary(site, now);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      if (refreshAll) await refreshAll();
      setNow(Date.now());
      toast.success('Telemetry data refreshed');
    } catch (e) {
      toast.error('Failed to refresh data');
    } finally {
      setRefreshing(false);
    }
  };

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
          <div className="dh-name">
            {site.name}
            {site.deviceType && site.deviceType !== site.name && (
              <span className="badge" style={{ verticalAlign: 'middle', marginLeft: 8, background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid var(--primary-glow)' }}>
                {site.deviceType}
              </span>
            )}
          </div>
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

      {/* Telemetry Overview Strip */}
      <div className="telemetry-strip">
        <div className="telemetry-strip-left">
          <div className={`telemetry-beacon ${telSummary.hasWarnings ? (telSummary.delayedCount > 0 ? 'delayed' : 'offline') : 'live'}`}>
            <span className={telSummary.hasWarnings ? (telSummary.delayedCount > 0 ? 'telemetry-delayed-dot' : 'telemetry-offline-dot') : 'telemetry-live-dot'}></span>
            <span>
              {telSummary.isAllLive
                ? 'All Analyzers Transmitting Live'
                : `${telSummary.liveCount}/${telSummary.totalParams} Analyzers Active`}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--ink-3)' }}>Latest Telemetry Packet:</span>
            <b style={{ color: 'var(--ink)' }}>{telSummary.siteFormattedTime}</b>
            <span className="badge" style={{ fontSize: 10, padding: '2px 8px', background: 'var(--surface-3)', color: 'var(--ink-2)' }}>
              {telSummary.siteTimeAgo}
            </span>
          </div>
        </div>

        <div className="telemetry-strip-right">
          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
            CPCB Cycle: 15-min
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleManualRefresh}
            disabled={refreshing}
            style={{ height: 28, fontSize: 11, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 5 }}
            title="Force refresh telemetry from server"
          >
            <span className={refreshing ? 'spin-icon' : ''}>🔄</span>
            <span>{refreshing ? 'Syncing…' : 'Sync Telemetry'}</span>
          </button>
        </div>
      </div>

      {/* Live gauges — using custom name, manual PID, and separate Last Data Received visual */}
      <div className="gauge-row">
        {site.params.map((p, idx) => {
          const def = PARAMS[p.key] || {};
          const col = HEX[p.signal];
          const pct = Math.min(
            100,
            (p.value / ((p.limit || def.limit || 100) * 1.6)) * 100
          );
          const displayName = p.name ? String(p.name).replace(/\bSO2\b/gi, 'SOX').replace(/SO₂/g, 'SOX') : (p.key === 'SO2' ? 'SOX' : p.key);
          const tel = getParamTelemetry(p, site, now);

          return (
            <div className="gauge" key={p.pid || p.key + '-' + idx}>
              <div className="gp" title={(p.key === 'SO2' ? 'SOX' : p.key) + ' · ' + (p.pid || '')}>
                {displayName}
              </div>
              {p.pid && (
                <div style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  PID: {p.pid}
                </div>
              )}
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

              {/* Visual of Last Data Received for this specific parameter */}
              <div className="gauge-last-data">
                <div className="gld-header">
                  <span className="gld-title">
                    <span
                      className={
                        tel.status === 'live'
                          ? 'telemetry-live-dot'
                          : tel.status === 'delayed'
                          ? 'telemetry-delayed-dot'
                          : 'telemetry-offline-dot'
                      }
                    ></span>
                    Last Received
                  </span>
                  <span className={`gld-time-pill ${tel.status}`}>
                    {tel.timeAgoStr}
                  </span>
                </div>
                <div className="gld-timestamp">
                  <span className="gld-clock" title={tel.formattedFullDate}>
                    🕒 {tel.formattedTime}
                  </span>
                  <span className="gld-status-tag" style={{ color: tel.badgeColor }}>
                    {tel.statusText}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Parameter Telemetry & Last Data Reception Monitor */}
      <ParameterTelemetryMonitor
        site={site}
        now={now}
        onRefresh={handleManualRefresh}
        refreshing={refreshing}
      />

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

      {/* Grading counters table — with Last Data Received column */}
      <Panel
        title="CPCB Grading Counters & Telemetry Status"
        hint="Rolling compliance metrics and last transmission timestamp per analyzer"
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
                <th>Last Data Received</th>
                <th>Exc today</th>
                <th>Warn/30d</th>
                <th>Conn-fail</th>
                <th>Frozen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {site.params.map((p, idx) => {
                const tel = getParamTelemetry(p, site, now);
                const displayName = p.name ? String(p.name).replace(/\bSO2\b/gi, 'SOX').replace(/SO₂/g, 'SOX') : (p.key === 'SO2' ? 'SOX' : p.key);
                const displayKey = p.key === 'SO2' ? 'SOX' : p.key;
                return (
                  <tr key={p.pid || p.key + '-' + idx}>
                    <td className="mono">{p.pid || pidFor(site.id, p.key)}</td>
                    <td>
                      <b>{displayName}</b>
                    </td>
                    <td className="mono">{displayKey}</td>
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
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          className={
                            tel.status === 'live'
                              ? 'telemetry-live-dot'
                              : tel.status === 'delayed'
                              ? 'telemetry-delayed-dot'
                              : 'telemetry-offline-dot'
                          }
                        ></span>
                        <span><b>{tel.formattedTime}</b></span>
                        <span className={`gld-time-pill ${tel.status}`} style={{ fontSize: 9 }}>
                          {tel.timeAgoStr}
                        </span>
                      </div>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}