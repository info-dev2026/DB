import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { SIG_LABEL, pidFor, isDataReceiving, formatParamValue } from '../utils/cpcb';
import { getParamTelemetry } from '../utils/telemetry';
import Panel from '../components/UI/Panel';
import TrendLine from '../components/Charts/TrendLine';
import ParameterTelemetryMonitor from '../components/UI/ParameterTelemetryMonitor';
import Modal from '../components/UI/Modal';
import toast from 'react-hot-toast';

export default function SiteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { sites, refreshAll, syncTelemetry, updateParam } = useData();
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [editParam, setEditParam] = useState(null);
  const [savingParam, setSavingParam] = useState(false);

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
            {site.email && (
              <span>
                <b style={{ color: 'var(--ink-2)', fontWeight: 500 }}>Email:</b>{' '}
                {site.email}
              </span>
            )}
            <span>
              {site.stacks || 0} stack · {site.etp || 0} ETP
            </span>
          </div>
          {Array.isArray(site.notifyEmails) && site.notifyEmails.length > 0 && (
            <div className="dh-meta" style={{ marginTop: 4 }}>
              <span>
                <b style={{ color: 'var(--ink-2)', fontWeight: 500 }}>Alert Notification Emails:</b>{' '}
                {site.notifyEmails.join(', ')}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {session?.role !== 'industry' && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => navigate(`/addsite?edit=${site.id}`)}
              title="Edit site parameters & notification emails"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <span>✏️</span>
              <span>Edit Site & Emails</span>
            </button>
          )}
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
          {!site.enabled && <span className="badge grey">Hidden</span>}
          {!site.running && <span className="badge grey">Stopped</span>}
          <span className="status-pill" style={{ fontSize: 14 }}>
            <span className={'status-dot ' + site.signal}></span>
            {SIG_LABEL[site.signal]}
          </span>
        </div>
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
                const isRec = isDataReceiving(p, site);
                const valDisplay = formatParamValue(p, site);
                return (
                  <tr key={p.pid || p.key + '-' + idx}>
                    <td className="mono">{p.pid || pidFor(site.id, p.key)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <b>{displayName}</b>
                        {session?.role !== 'industry' && (
                          <button
                            type="button"
                            onClick={() =>
                              setEditParam({
                                pid: p.pid,
                                name: p.name || displayName,
                                limit: p.limit ?? 100,
                                unit: p.unit || '',
                              })
                            }
                            title="Rename parameter"
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '1px 4px',
                              fontSize: 11,
                              opacity: 0.5,
                            }}
                          >
                            ✏️
                          </button>
                        )}
                      </div>
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

      {/* Quick Parameter Rename Modal */}
      {editParam && (
        <Modal
          open={true}
          title={`Rename Parameter: ${editParam.pid}`}
          onClose={() => setEditParam(null)}
          width={460}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setEditParam(null)}
                disabled={savingParam}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingParam || !editParam.name.trim()}
                onClick={async () => {
                  setSavingParam(true);
                  try {
                    await updateParam(site.id || site.siteCode, editParam.pid, {
                      name: editParam.name.trim(),
                      limit: Number(editParam.limit),
                    });
                    toast.success(`Parameter renamed to "${editParam.name.trim()}"`);
                    setEditParam(null);
                  } catch (err) {
                    toast.error(err.message || 'Failed to update parameter');
                  } finally {
                    setSavingParam(false);
                  }
                }}
              >
                {savingParam ? 'Saving…' : 'Save Name'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', display: 'block', marginBottom: 4 }}>
                Parameter ID (PID)
              </label>
              <input
                value={editParam.pid}
                disabled
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: 'var(--surface-2, rgba(0,0,0,0.04))',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  color: 'var(--ink-3)',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', display: 'block', marginBottom: 4 }}>
                Display Name <span style={{ color: 'var(--st-red, red)' }}>*</span>
              </label>
              <input
                value={editParam.name}
                onChange={(e) => setEditParam({ ...editParam, name: e.target.value })}
                placeholder="e.g. Stack 1 PM, Inlet PM"
                autoFocus
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 14,
                  fontFamily: 'inherit',
                }}
              />
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                This label appears across the live dashboard, reports, and alerts.
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', display: 'block', marginBottom: 4 }}>
                CPCB Limit ({editParam.unit || 'unit'})
              </label>
              <input
                type="number"
                step="any"
                value={editParam.limit}
                onChange={(e) => setEditParam({ ...editParam, limit: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 13,
                  fontFamily: 'monospace',
                }}
              />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}