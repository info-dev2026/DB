import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import {
  PARAMS,
  SIG_LABEL,
  HEX,
  RANK,
  isDataReceiving,
  formatParamValue,
  generateParamIdFromStack,
} from '../utils/cpcb';
import { fmtConfiguredDate } from '../utils/formatters';
import Panel from '../components/UI/Panel';
import toast from 'react-hot-toast';

const STATUS_FILTERS = [
  ['all', 'All Stations', null],
  ['green', 'Normal', '#10b981'],
  ['yellow', 'Warning', '#f59e0b'],
  ['exceed', 'Exceedance', '#ef4444'],
  ['grey', 'Offline / Delay', '#64748b'],
];

/* ------------------------------------------------------------
   Parameter Row in Edit Form
   ------------------------------------------------------------ */
function ParamConfigRow({ row, index, total, siteCode, onChange, onRemove, onAdd }) {
  const def = PARAMS[row.key] || {};

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 1.2fr 1.3fr 1.4fr 85px 65px',
        gap: 8,
        alignItems: 'center',
        padding: '10px 12px',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--surface)',
        marginBottom: 8,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--ink-3)',
          textTransform: 'uppercase',
          letterSpacing: '.05em',
        }}
      >
        Param {index + 1}
      </span>

      <select
        value={row.key}
        onChange={(e) => {
          const nextKey = e.target.value;
          const autoPid = generateParamIdFromStack(row.name || `STACK ${index + 1}`, nextKey || 'PM', siteCode);
          onChange({
            ...row,
            key: nextKey,
            pid: autoPid,
            unit: (PARAMS[nextKey] && PARAMS[nextKey].unit) || row.unit || '',
            limit: row.limit != null ? row.limit : ((PARAMS[nextKey] && PARAMS[nextKey].limit) || 0),
          });
        }}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--surface-2)',
          color: 'var(--ink)',
          fontSize: 13,
        }}
      >
        <option value="">— Select Type —</option>
        {Object.keys(PARAMS).map((k) => (
          <option key={k} value={k}>
            {k} — {PARAMS[k].label || k}
          </option>
        ))}
      </select>

      <input
        value={row.name || ''}
        onChange={(e) => {
          const nextName = e.target.value;
          const autoPid = generateParamIdFromStack(nextName || `STACK ${index + 1}`, row.key || 'PM', siteCode);
          onChange({ ...row, name: nextName, pid: autoPid });
        }}
        placeholder={`e.g. STACK ${index + 1}`}
        title="Stack or Outlet designation"
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--surface-2)',
          color: 'var(--ink)',
          fontSize: 13,
        }}
      />

      <input
        value={row.pid || generateParamIdFromStack(row.name || `STACK ${index + 1}`, row.key || 'PM', siteCode)}
        readOnly
        placeholder="Auto PID"
        title="Parameter ID automatically linked to stack"
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--surface)',
          color: 'var(--primary)',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
        }}
      />

      <input
        type="number"
        step="any"
        value={row.limit != null ? row.limit : ''}
        onChange={(e) => onChange({ ...row, limit: +e.target.value })}
        placeholder="Limit"
        title={def.unit ? `Limit in ${def.unit}` : 'Threshold limit'}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--surface-2)',
          color: 'var(--ink)',
          fontSize: 13,
          fontFamily: 'monospace',
        }}
      />

      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onAdd}
          title="Add parameter"
          style={{ padding: '6px 8px', minWidth: 28 }}
        >
          ＋
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onRemove}
          disabled={total <= 1}
          title="Remove parameter"
          style={{ padding: '6px 8px', minWidth: 28 }}
        >
          −
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   Email List Row in Edit Form
   ------------------------------------------------------------ */
function EmailRow({ value, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
      <input
        type="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. alerts@company.com"
        style={{
          flex: 1,
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--surface-2)',
          color: 'var(--ink)',
          fontSize: 13,
        }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={onRemove}
        title="Remove this email"
        style={{ padding: '6px 10px' }}
      >
        −
      </button>
    </div>
  );
}

/* ------------------------------------------------------------
   MAIN MONITORING PAGE COMPONENT
   ------------------------------------------------------------ */
export default function Monitoring() {
  const { sites, updateSite, createSite, refreshAll, syncTelemetry } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Active section tab: 'data' (Data Monitoring) or 'edit' (Edit Site Details)
  const activeTab = searchParams.get('tab') === 'edit' ? 'edit' : 'data';

  // Data monitoring states
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table'
  const [syncing, setSyncing] = useState(false);
  const [, setTicker] = useState(Date.now());

  // Edit site details states
  const [selectedSiteId, setSelectedSiteId] = useState(searchParams.get('site') || '');
  const [isNewMode, setIsNewMode] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form model
  const [form, setForm] = useState({
    id: '',
    name: '',
    sector: '',
    loc: '',
    contact: '',
    phone: '',
    email: '',
    passcode: '',
    deviceType: '',
    stacks: 1,
    etp: 0,
    notifyEmails: [''],
    params: [],
  });

  // 10-second ticker for real-time elapsed time recalculation
  useEffect(() => {
    const t = setInterval(() => setTicker(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  // Update selectedSiteId when URL query changes
  useEffect(() => {
    const siteParam = searchParams.get('site');
    if (siteParam) {
      setSelectedSiteId(siteParam);
      setIsNewMode(false);
    } else if (!selectedSiteId && sites.length > 0) {
      setSelectedSiteId(sites[0].id);
    }
  }, [searchParams, sites]);

  // Load site details into form when selectedSiteId changes or mode toggles
  useEffect(() => {
    if (isNewMode) {
      setForm({
        id: '',
        name: '',
        sector: 'Manufacturing',
        loc: '',
        contact: '',
        phone: '',
        email: '',
        passcode: '1234',
        deviceType: 'Continuous Emission Analyzer',
        stacks: 1,
        etp: 0,
        notifyEmails: [''],
        params: [
          { key: 'PM', name: 'STACK 1', pid: 'STACK-1-PM', limit: 50, unit: 'mg/Nm³' },
          { key: 'SO2', name: 'STACK 1', pid: 'STACK-1-SOX', limit: 100, unit: 'mg/Nm³' },
        ],
      });
      return;
    }

    if (!selectedSiteId && sites.length > 0) {
      setSelectedSiteId(sites[0].id);
      return;
    }

    const current = sites.find((s) => s.id === selectedSiteId);
    if (current) {
      setForm({
        id: current.id,
        name: current.name || '',
        sector: current.sector || '',
        loc: current.loc || '',
        contact: current.contact || '',
        phone: current.phone || '',
        email: current.email || '',
        passcode: current.passcode || '',
        deviceType: current.deviceType || current.name || '',
        stacks: current.stacks != null ? current.stacks : 1,
        etp: current.etp != null ? current.etp : 0,
        notifyEmails:
          Array.isArray(current.notifyEmails) && current.notifyEmails.length > 0
            ? [...current.notifyEmails]
            : [''],
        params:
          Array.isArray(current.params) && current.params.length > 0
            ? current.params.map((p) => ({ ...p }))
            : [{ key: 'PM', name: 'STACK 1', pid: 'STACK-1-PM', limit: 50, unit: 'mg/Nm³' }],
      });
    }
  }, [selectedSiteId, isNewMode, sites]);

  // Switch between Data Monitoring and Edit Site Details
  const switchTab = (tab, siteId) => {
    const nextParams = new URLSearchParams(searchParams);
    if (tab === 'edit') {
      nextParams.set('tab', 'edit');
      if (siteId) nextParams.set('site', siteId);
    } else {
      nextParams.delete('tab');
      nextParams.delete('site');
    }
    setSearchParams(nextParams);
  };

  // Sync telemetry manual action
  const handleSyncTelemetry = async () => {
    setSyncing(true);
    try {
      if (syncTelemetry) {
        await syncTelemetry();
      } else if (refreshAll) {
        await refreshAll();
      }
      setTicker(Date.now());
      toast.success('⚡ Telemetry synced · Real-time data updated');
    } catch {
      toast.error('Failed to sync telemetry data');
    } finally {
      setSyncing(false);
    }
  };

  // Filtered sites for Data Monitoring
  const filteredSites = useMemo(() => {
    return sites
      .filter((s) => {
        // Status filter
        if (statusFilter === 'green' && s.signal !== 'green') return false;
        if (statusFilter === 'yellow' && s.signal !== 'yellow') return false;
        if (statusFilter === 'exceed' && !['red', 'orange', 'purple'].includes(s.signal)) return false;
        if (statusFilter === 'grey' && !['grey', 'delay'].includes(s.signal) && s.connectivity !== 'grey') return false;

        // Search text
        if (query.trim()) {
          const q = query.trim().toLowerCase();
          const match =
            (s.name || '').toLowerCase().includes(q) ||
            (s.id || '').toLowerCase().includes(q) ||
            (s.sector || '').toLowerCase().includes(q) ||
            (s.loc || '').toLowerCase().includes(q) ||
            (s.params || []).some((p) => (p.name || p.key || '').toLowerCase().includes(q));
          if (!match) return false;
        }

        return true;
      })
      .sort((a, b) => (RANK[b.signal] || 0) - (RANK[a.signal] || 0));
  }, [sites, statusFilter, query]);

  // KPI statistics
  const stats = useMemo(() => {
    let green = 0;
    let yellow = 0;
    let exceed = 0;
    let grey = 0;
    let totalParams = 0;

    sites.forEach((s) => {
      const isOff = s.signal === 'grey' || s.signal === 'delay' || s.connectivity === 'grey';
      if (isOff) grey++;
      else if (s.signal === 'green') green++;
      else if (s.signal === 'yellow') yellow++;
      else if (['red', 'orange', 'purple'].includes(s.signal)) exceed++;
      else grey++;

      if (Array.isArray(s.params)) totalParams += s.params.length;
    });

    return { total: sites.length, green, yellow, exceed, grey, totalParams };
  }, [sites]);

  // Handle Save in Edit Site Details
  const handleSaveForm = async (andViewMonitoring = false) => {
    if (!form.name.trim()) {
      toast.error('Site / Station Name is required');
      return;
    }
    if (!form.id.trim()) {
      toast.error('Station ID / Code is required');
      return;
    }

    setSaving(true);
    try {
      const cleanEmails = (form.notifyEmails || []).map((e) => e.trim()).filter((e) => e && e.includes('@'));
      const payload = {
        ...form,
        id: form.id.trim().toUpperCase(),
        notifyEmails: cleanEmails,
        params: (form.params || []).map((p, idx) => ({
          ...p,
          name: p.name || `STACK ${idx + 1}`,
          pid: p.pid || generateParamIdFromStack(p.name || `STACK ${idx + 1}`, p.key || 'PM', form.id),
          limit: p.limit != null ? +p.limit : 0,
        })),
      };

      if (isNewMode) {
        await createSite(payload);
        toast.success(`Station "${payload.name}" registered successfully`);
        setIsNewMode(false);
        setSelectedSiteId(payload.id);
      } else {
        await updateSite(form.id, payload);
        toast.success(`Details for "${payload.name}" updated successfully`);
      }

      if (andViewMonitoring) {
        switchTab('data');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to save site details');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="monitoring-page" style={{ paddingBottom: 40 }}>
      {/* ---------------- TOP HEADER & NAVIGATION SWITCHER ---------------- */}
      <div
        className="page-head"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          padding: '16px 20px',
          background: 'var(--surface)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 10px #10b981',
              }}
            />
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
              Monitoring Control Centre
            </h1>
            <span
              className="badge"
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              Live Telemetry &amp; Site Manager
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
            Dedicated interface for real-time emission &amp; effluent data monitoring and site configuration.
          </div>
        </div>

        {/* Tab switch buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              display: 'inline-flex',
              background: 'var(--surface-2)',
              borderRadius: 8,
              padding: 3,
              border: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              onClick={() => switchTab('data')}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                background: activeTab === 'data' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'data' ? '#ffffff' : 'var(--ink-2)',
                fontWeight: activeTab === 'data' ? 600 : 500,
                fontSize: 13,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 120ms ease',
              }}
            >
              <span>📡</span>
              <span>Data Monitoring</span>
            </button>
            <button
              type="button"
              onClick={() => switchTab('edit')}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                background: activeTab === 'edit' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'edit' ? '#ffffff' : 'var(--ink-2)',
                fontWeight: activeTab === 'edit' ? 600 : 500,
                fontSize: 13,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 120ms ease',
              }}
            >
              <span>✏️</span>
              <span>Edit Site Details</span>
            </button>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/reports')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 38 }}
            title="Open Compliance & Telemetry Reports"
          >
            <span>📑</span>
            <span>Reports</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleSyncTelemetry}
            disabled={syncing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 38 }}
            title="Sync telemetry data immediately"
          >
            <span className={syncing ? 'spin-icon' : ''}>⚡</span>
            <span>{syncing ? 'Syncing…' : 'Sync Telemetry'}</span>
          </button>
        </div>
      </div>

      {/* ============================================================
          SECTION 1: DATA MONITORING PART
          ============================================================ */}
      {activeTab === 'data' && (
        <div className="monitoring-data-section">
          {/* KPI Interactive Filter Buttons */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            {/* Total / All */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter('all')}
              title="Click to show all monitored stations"
              style={{
                background: 'var(--surface)',
                border: statusFilter === 'all' ? '2px solid var(--primary)' : '1px solid var(--border)',
                boxShadow: statusFilter === 'all' ? '0 0 12px var(--primary-glow)' : 'none',
                borderRadius: 10,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                transition: 'all 150ms ease',
                transform: statusFilter === 'all' ? 'translateY(-2px)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>Monitored Stations</span>
                {statusFilter === 'all' && (
                  <span style={{ fontSize: 10, background: 'var(--primary-soft)', color: 'var(--primary)', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>Active</span>
                )}
              </div>
              <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)', marginTop: 4 }}>{stats.total}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>{stats.totalParams} parameters linked</span>
            </div>

            {/* Normal / Active */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter(statusFilter === 'green' ? 'all' : 'green')}
              title="Click to filter by Normal / Active stations"
              style={{
                background: statusFilter === 'green' ? 'rgba(16, 185, 129, 0.08)' : 'var(--surface)',
                border: statusFilter === 'green' ? '2px solid #10b981' : '1px solid rgba(16, 185, 129, 0.3)',
                boxShadow: statusFilter === 'green' ? '0 0 14px rgba(16, 185, 129, 0.35)' : 'none',
                borderRadius: 10,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                transition: 'all 150ms ease',
                transform: statusFilter === 'green' ? 'translateY(-2px)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>Normal / Active</span>
                {statusFilter === 'green' && (
                  <span style={{ fontSize: 10, background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>Filtered</span>
                )}
              </div>
              <span style={{ fontSize: 24, fontWeight: 700, color: '#10b981', marginTop: 4 }}>{stats.green}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>Within compliance limits</span>
            </div>

            {/* Warning */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter(statusFilter === 'yellow' ? 'all' : 'yellow')}
              title="Click to filter by Warning stations"
              style={{
                background: statusFilter === 'yellow' ? 'rgba(245, 158, 11, 0.08)' : 'var(--surface)',
                border: statusFilter === 'yellow' ? '2px solid #f59e0b' : '1px solid rgba(245, 158, 11, 0.3)',
                boxShadow: statusFilter === 'yellow' ? '0 0 14px rgba(245, 158, 11, 0.35)' : 'none',
                borderRadius: 10,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                transition: 'all 150ms ease',
                transform: statusFilter === 'yellow' ? 'translateY(-2px)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>Warning</span>
                {statusFilter === 'yellow' && (
                  <span style={{ fontSize: 10, background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>Filtered</span>
                )}
              </div>
              <span style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b', marginTop: 4 }}>{stats.yellow}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>Approaching threshold</span>
            </div>

            {/* Exceedance */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter(statusFilter === 'exceed' ? 'all' : 'exceed')}
              title="Click to filter by Exceedance stations"
              style={{
                background: statusFilter === 'exceed' ? 'rgba(239, 68, 68, 0.08)' : 'var(--surface)',
                border: statusFilter === 'exceed' ? '2px solid #ef4444' : '1px solid rgba(239, 68, 68, 0.3)',
                boxShadow: statusFilter === 'exceed' ? '0 0 14px rgba(239, 68, 68, 0.35)' : 'none',
                borderRadius: 10,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                transition: 'all 150ms ease',
                transform: statusFilter === 'exceed' ? 'translateY(-2px)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>Exceedance</span>
                {statusFilter === 'exceed' && (
                  <span style={{ fontSize: 10, background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>Filtered</span>
                )}
              </div>
              <span style={{ fontSize: 24, fontWeight: 700, color: '#ef4444', marginTop: 4 }}>{stats.exceed}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>Exceeded standard limit</span>
            </div>

            {/* Offline / Delay */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter(statusFilter === 'grey' ? 'all' : 'grey')}
              title="Click to filter by Offline / Delay stations"
              style={{
                background: statusFilter === 'grey' ? 'rgba(100, 116, 139, 0.12)' : 'var(--surface)',
                border: statusFilter === 'grey' ? '2px solid #64748b' : '1px solid rgba(100, 116, 139, 0.3)',
                boxShadow: statusFilter === 'grey' ? '0 0 14px rgba(100, 116, 139, 0.35)' : 'none',
                borderRadius: 10,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                transition: 'all 150ms ease',
                transform: statusFilter === 'grey' ? 'translateY(-2px)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Offline / Delay</span>
                {statusFilter === 'grey' && (
                  <span style={{ fontSize: 10, background: 'rgba(100, 116, 139, 0.2)', color: '#64748b', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>Filtered</span>
                )}
              </div>
              <span style={{ fontSize: 24, fontWeight: 700, color: '#64748b', marginTop: 4 }}>{stats.grey}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>No data feed received</span>
            </div>
          </div>

          {/* Filtering and Search Controls */}
          <Panel
            title="Real-Time Station Telemetry Monitor"
            hint={`${filteredSites.length} station${filteredSites.length === 1 ? '' : 's'} displayed`}
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {/* View toggle */}
                <div className="view-toggle" style={{ display: 'flex' }}>
                  <button
                    type="button"
                    className={`view-btn ${viewMode === 'cards' ? 'active' : ''}`}
                    onClick={() => setViewMode('cards')}
                    title="Station cards view"
                  >
                    Cards
                  </button>
                  <button
                    type="button"
                    className={`view-btn ${viewMode === 'table' ? 'active' : ''}`}
                    onClick={() => setViewMode('table')}
                    title="Compact tabular view"
                  >
                    Table
                  </button>
                </div>

                {/* Filter chips */}
                <div className="chips">
                  {STATUS_FILTERS.map(([f, l, col]) => (
                    <button
                      key={f}
                      type="button"
                      className={'chip' + (statusFilter === f ? ' on' : '')}
                      onClick={() => setStatusFilter(f)}
                    >
                      {col ? <span className="cdot" style={{ background: col }}></span> : null}
                      {l}
                    </button>
                  ))}
                  <input
                    className="search"
                    placeholder="Search station, ID, parameter…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={{ minWidth: 220 }}
                  />
                </div>
              </div>
            }
          >
            {filteredSites.length === 0 ? (
              <div className="empty" style={{ padding: 40, textAlign: 'center' }}>
                No stations match the selected filter criteria.
              </div>
            ) : viewMode === 'cards' ? (
              /* CARD VIEW */
              <div className="station-card-list">
                {filteredSites.map((s) => (
                  <div
                    key={s.id}
                    className="station-card"
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '14px 18px',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      marginBottom: 10,
                    }}
                  >
                    {/* Col 1: Station name & location */}
                    <div style={{ minWidth: 200, flex: 1.2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          className={`status-dot ${s.signal}`}
                          style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0 }}
                        />
                        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{s.name}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
                        <span className="mono" style={{ fontWeight: 500 }}>{s.id}</span>
                        <span> · </span>
                        <span>{s.sector || 'Environmental Monitoring'}</span>
                        {s.loc ? <span> · {s.loc}</span> : null}
                      </div>
                    </div>

                    {/* Col 2: Configured date & device info */}
                    <div style={{ minWidth: 150 }}>
                      <div style={{ fontSize: 11, color: 'var(--ink-4)', textTransform: 'uppercase' }}>Device Info</div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500, marginTop: 2 }}>
                        {s.deviceType || 'Analyzer Station'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
                        Registered: {fmtConfiguredDate(s.createdAt)}
                      </div>
                    </div>

                    {/* Col 3: Live parameter chips */}
                    <div style={{ minWidth: 320, flex: 2 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--ink-4)', textTransform: 'uppercase' }}>
                          Live Parameters ({s.params?.length || 0})
                        </span>
                        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                          {s.lastData || 'Continuous feed'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        {(s.params || []).map((p, i) => {
                          const isRec = isDataReceiving(p, s);
                          const displayVal = formatParamValue(p, s);
                          const effectiveSig = isRec && (!p.signal || p.signal === 'grey') ? 'green' : (p.signal || 'green');
                          const sigHex = HEX[effectiveSig] || '#10b981';
                          const pName = p.name ? String(p.name).replace(/\bSO2\b/gi, 'SOX') : (p.key === 'SO2' ? 'SOX' : p.key);

                          return (
                            <div
                              key={p.pid || i}
                              title={`${pName} [${p.pid || 'PID'}]: ${displayVal} ${p.unit || ''} (Limit: ${p.limit != null ? p.limit : '—'} ${p.unit || ''})`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '3px 8px',
                                borderRadius: 6,
                                background: 'var(--surface-2)',
                                border: `1px solid ${isRec ? sigHex : 'var(--border)'}`,
                                fontSize: 11.5,
                              }}
                            >
                              <span
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  background: isRec ? sigHex : '#64748b',
                                  flexShrink: 0,
                                }}
                              />
                              <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{pName}:</span>
                              <span className="mono" style={{ color: isRec ? 'var(--ink)' : 'var(--ink-4)', fontWeight: 700 }}>
                                {displayVal}
                              </span>
                              {p.unit ? <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{p.unit}</span> : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Col 4: Quick Actions */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => switchTab('edit', s.id)}
                        title="Edit site information, parameters & email alerts"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      >
                        <span>✏️</span>
                        <span>Edit Details</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => navigate(`/sites/${s.id}`)}
                        title="View comprehensive telemetry monitor for this site"
                      >
                        Inspect
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* TABLE VIEW */
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Station Name</th>
                      <th>Device ID</th>
                      <th>Sector / Location</th>
                      <th>Live Parameters &amp; Readings</th>
                      <th>Last Data</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSites.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <span className={`status-pill`}>
                            <span className={`status-dot ${s.signal}`} />
                            {SIG_LABEL[s.signal] || s.signal}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{s.deviceType || 'Analyzer'}</div>
                        </td>
                        <td>
                          <span className="mono" style={{ fontWeight: 600 }}>{s.id}</span>
                        </td>
                        <td>
                          <div>{s.sector || '—'}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{s.loc || '—'}</div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {(s.params || []).slice(0, 4).map((p, i) => {
                              const isRec = isDataReceiving(p, s);
                              const displayVal = formatParamValue(p, s);
                              const pName = p.name ? String(p.name).replace(/\bSO2\b/gi, 'SOX') : (p.key === 'SO2' ? 'SOX' : p.key);
                              return (
                                <span
                                  key={p.pid || i}
                                  className="mono"
                                  style={{
                                    fontSize: 11,
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    background: 'var(--surface-2)',
                                    border: isRec ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid var(--border)',
                                    color: isRec ? 'var(--ink)' : 'var(--ink-4)',
                                  }}
                                >
                                  {pName}: <b>{displayVal}</b>
                                </span>
                              );
                            })}
                            {(s.params || []).length > 4 && (
                              <span style={{ fontSize: 10.5, color: 'var(--ink-4)', alignSelf: 'center' }}>
                                +{(s.params || []).length - 4} more
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                          {s.lastData || 'Just now'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-xs"
                            onClick={() => switchTab('edit', s.id)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <span>✏️</span>
                            <span>Edit</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ============================================================
          SECTION 2: EDIT SITE DETAILS PART ONLY
          ============================================================ */}
      {activeTab === 'edit' && (
        <div className="monitoring-edit-section">
          {/* Station Selector Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              padding: '12px 16px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Select Station to Edit:</span>
              <select
                value={isNewMode ? '__new__' : selectedSiteId}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setIsNewMode(true);
                  } else {
                    setIsNewMode(false);
                    setSelectedSiteId(e.target.value);
                  }
                }}
                style={{
                  padding: '7px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--ink)',
                  fontSize: 13,
                  fontWeight: 500,
                  minWidth: 260,
                }}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id}) — {s.sector || 'Monitoring'}
                  </option>
                ))}
                <option value="__new__">＋ Register New Station</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {!isNewMode && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setIsNewMode(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <span>＋</span>
                  <span>New Station</span>
                </button>
              )}
              {isNewMode && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setIsNewMode(false);
                    if (sites.length > 0) setSelectedSiteId(sites[0].id);
                  }}
                >
                  Cancel New Station
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => switchTab('data')}
                title="Return to Data Monitoring view"
              >
                ← Back to Data Monitoring
              </button>
            </div>
          </div>

          {/* Edit Form Panel */}
          <Panel
            title={isNewMode ? 'Register New Monitoring Station' : `Edit Station Details: ${form.name || form.id}`}
            hint="Update station information, contact details, email notification channels, and telemetry parameters"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveForm(false);
              }}
            >
              {/* Row 1: Core Station Identifiers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 16 }}>
                <div className="fg">
                  <label style={{ fontWeight: 600, fontSize: 12 }}>Station / Site Name *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. UltraTech Cement Stack 1"
                    required
                  />
                </div>

                <div className="fg">
                  <label style={{ fontWeight: 600, fontSize: 12 }}>Device ID / Industry Code *</label>
                  <input
                    value={form.id}
                    onChange={(e) => setForm({ ...form, id: e.target.value.toUpperCase() })}
                    placeholder="e.g. UTC_CEMENT_01"
                    disabled={!isNewMode}
                    required
                  />
                  {!isNewMode && (
                    <span style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
                      Station ID is fixed after registration.
                    </span>
                  )}
                </div>

                <div className="fg">
                  <label style={{ fontWeight: 600, fontSize: 12 }}>Industry Sector</label>
                  <input
                    value={form.sector}
                    onChange={(e) => setForm({ ...form, sector: e.target.value })}
                    placeholder="e.g. Thermal Power, Chemical, Cement"
                  />
                </div>

                <div className="fg">
                  <label style={{ fontWeight: 600, fontSize: 12 }}>Location / City &amp; State</label>
                  <input
                    value={form.loc}
                    onChange={(e) => setForm({ ...form, loc: e.target.value })}
                    placeholder="e.g. Surat, Gujarat"
                  />
                </div>
              </div>

              {/* Row 2: Equipment & Technical Configuration */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
                <div className="fg">
                  <label style={{ fontWeight: 600, fontSize: 12 }}>Device / Analyzer Type</label>
                  <input
                    value={form.deviceType}
                    onChange={(e) => setForm({ ...form, deviceType: e.target.value })}
                    placeholder="e.g. Continuous Emission Monitoring"
                  />
                </div>

                <div className="fg">
                  <label style={{ fontWeight: 600, fontSize: 12 }}>Number of Stacks</label>
                  <input
                    type="number"
                    min="0"
                    value={form.stacks}
                    onChange={(e) => setForm({ ...form, stacks: +e.target.value })}
                  />
                </div>

                <div className="fg">
                  <label style={{ fontWeight: 600, fontSize: 12 }}>Number of ETP Outlets</label>
                  <input
                    type="number"
                    min="0"
                    value={form.etp}
                    onChange={(e) => setForm({ ...form, etp: +e.target.value })}
                  />
                </div>

                <div className="fg">
                  <label style={{ fontWeight: 600, fontSize: 12 }}>Station Access Passcode</label>
                  <input
                    type="text"
                    value={form.passcode}
                    onChange={(e) => setForm({ ...form, passcode: e.target.value })}
                    placeholder="e.g. 1234"
                  />
                </div>
              </div>

              {/* Row 3: Contact & Communication */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 20 }}>
                <div className="fg">
                  <label style={{ fontWeight: 600, fontSize: 12 }}>Contact Person</label>
                  <input
                    value={form.contact}
                    onChange={(e) => setForm({ ...form, contact: e.target.value })}
                    placeholder="e.g. Rajesh Sharma"
                  />
                </div>

                <div className="fg">
                  <label style={{ fontWeight: 600, fontSize: 12 }}>Mobile / Phone</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="e.g. +91 98765 43210"
                  />
                </div>

                <div className="fg">
                  <label style={{ fontWeight: 600, fontSize: 12 }}>Official Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="e.g. plant.head@company.com"
                  />
                </div>
              </div>

              {/* Row 4: Alert Notification Emails */}
              <div style={{ marginBottom: 24, padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Alert Notification Emails</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                      Automated exceedance alerts and telemetry warnings will be dispatched to these recipients.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setForm({ ...form, notifyEmails: [...(form.notifyEmails || []), ''] })}
                  >
                    ＋ Add Email
                  </button>
                </div>

                {(form.notifyEmails || []).map((emailVal, idx) => (
                  <EmailRow
                    key={idx}
                    value={emailVal}
                    onChange={(nextVal) => {
                      const nextEmails = [...form.notifyEmails];
                      nextEmails[idx] = nextVal;
                      setForm({ ...form, notifyEmails: nextEmails });
                    }}
                    onRemove={() => {
                      const nextEmails = form.notifyEmails.filter((_, i) => i !== idx);
                      setForm({ ...form, notifyEmails: nextEmails.length ? nextEmails : [''] });
                    }}
                  />
                ))}
              </div>

              {/* Row 5: Monitoring Parameters Configuration */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>
                      Monitoring Parameters &amp; PIDs
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      Define analyzer channels, stack mapping, auto-generated PIDs, and standard compliance thresholds.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      const nextIndex = (form.params || []).length + 1;
                      const nextKey = 'PM';
                      const nextStack = `STACK ${nextIndex}`;
                      const autoPid = generateParamIdFromStack(nextStack, nextKey, form.id);
                      setForm({
                        ...form,
                        params: [
                          ...(form.params || []),
                          { key: nextKey, name: nextStack, pid: autoPid, limit: 50, unit: 'mg/Nm³' },
                        ],
                      });
                    }}
                  >
                    ＋ Add Parameter Channel
                  </button>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '60px 1.2fr 1.3fr 1.4fr 85px 65px',
                    gap: 8,
                    padding: '8px 12px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--ink-3)',
                    textTransform: 'uppercase',
                    letterSpacing: '.05em',
                  }}
                >
                  <span>Index</span>
                  <span>Type</span>
                  <span>Stack Designation</span>
                  <span>Auto PID</span>
                  <span>Limit</span>
                  <span style={{ textAlign: 'right' }}>Actions</span>
                </div>

                {(form.params || []).map((pRow, idx) => (
                  <ParamConfigRow
                    key={idx}
                    row={pRow}
                    index={idx}
                    total={(form.params || []).length}
                    siteCode={form.id}
                    onChange={(updatedRow) => {
                      const nextParams = [...form.params];
                      nextParams[idx] = updatedRow;
                      setForm({ ...form, params: nextParams });
                    }}
                    onRemove={() => {
                      const nextParams = form.params.filter((_, i) => i !== idx);
                      setForm({ ...form, params: nextParams });
                    }}
                    onAdd={() => {
                      const nextIndex = (form.params || []).length + 1;
                      const nextKey = 'SO2';
                      const nextStack = `STACK ${nextIndex}`;
                      const autoPid = generateParamIdFromStack(nextStack, nextKey, form.id);
                      setForm({
                        ...form,
                        params: [
                          ...(form.params || []),
                          { key: nextKey, name: nextStack, pid: autoPid, limit: 100, unit: 'mg/Nm³' },
                        ],
                      });
                    }}
                  />
                ))}
              </div>

              {/* Form Action Buttons */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: 12,
                  paddingTop: 16,
                  borderTop: '1px solid var(--border)',
                }}
              >
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => switchTab('data')}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleSaveForm(true)}
                  disabled={saving}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <span>💾</span>
                  <span>Save &amp; View Telemetry</span>
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 140 }}
                >
                  <span>✓</span>
                  <span>{saving ? 'Saving Changes…' : 'Save Details'}</span>
                </button>
              </div>
            </form>
          </Panel>
        </div>
      )}
    </div>
  );
}
