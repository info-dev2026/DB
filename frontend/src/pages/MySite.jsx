import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { SIG_LABEL, isDataReceiving, formatParamValue } from '../utils/cpcb';
import { siteServiceAlert } from '../utils/serviceHelpers';
import { getParamTelemetry } from '../utils/telemetry';
import Panel from '../components/UI/Panel';
import TrendLine from '../components/Charts/TrendLine';
import EngineerCard from '../components/UI/EngineerCard';
import ParameterTelemetryMonitor from '../components/UI/ParameterTelemetryMonitor';
import toast from 'react-hot-toast';

export default function MySite() {
  const { session } = useAuth();
  const { sites, refreshAll, syncTelemetry } = useData();
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);

  // 10-second ticker to dynamically update elapsed times ("just now", "2m ago")
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  const site = sites.find((s) => s.id === session?.siteId);

  if (!site) {
    return <div className="empty">No site linked to this login.</div>;
  }

  const alert = siteServiceAlert(site);

  const openSupport = () =>
    window.dispatchEvent(new CustomEvent('open-support'));

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      if (syncTelemetry && site?.id) {
        await syncTelemetry(site.id);
      } else if (refreshAll) {
        await refreshAll();
      }
      setNow(Date.now());
      toast.success('⚡ Telemetry synced · Immediate data updated');
    } catch (e) {
      toast.error('Failed to sync telemetry data');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      {/* Page header */}
      <div className="page-head">
        <div>
          <div className="page-title">
            {site.name}
            {site.deviceType && site.deviceType !== site.name && (
              <span className="badge" style={{ verticalAlign: 'middle', marginLeft: 8, background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid var(--primary-glow)' }}>
                {site.deviceType}
              </span>
            )}
          </div>
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
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleManualRefresh}
            disabled={refreshing}
            title="Sync telemetry immediately to get latest data"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <span className={refreshing ? 'spin-icon' : ''}>⚡</span>
            <span>{refreshing ? 'Syncing…' : 'Sync Telemetry'}</span>
          </button>
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
        hint="Last 24 readings"
      >
        <TrendLine site={site} />
      </Panel>

      {/* Grading counters with Last Data Received column */}
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
                <th>Key</th>
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
                const isRec = isDataReceiving(p, site);
                const valDisplay = formatParamValue(p, site);
                return (
                  <tr key={p.pid || p.key + '-' + idx}>
                    <td className="mono">{p.pid || '—'}</td>
                    <td>
                      <b>{displayName}</b>
                    </td>
                    <td className="mono">{displayKey}</td>
                    <td
                      className={
                        'mono ' +
                        (isRec && ['yellow', 'orange', 'red', 'purple'].includes(p.signal)
                          ? 'val-exc'
                          : (!isRec ? 'val-na' : ''))
                      }
                    >
                      {valDisplay} {isRec ? (p.unit || '') : ''}
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

      {/* Engineer */}
      <Panel title="Need help?">
        <EngineerCard />
      </Panel>
    </>
  );
}