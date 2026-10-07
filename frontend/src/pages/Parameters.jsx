import { useState, useMemo, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  PARAMS,
  saveCustomParam,
  deleteCustomParam,
  loadCustomParams,
} from '../utils/cpcb';
import { useData } from '../context/DataContext';
import Panel from '../components/UI/Panel';
import Modal from '../components/UI/Modal';

const PRESETS = [
  { key: 'NH3', label: 'Ammonia Gas', type: 'stack', unit: 'mg/Nm³', limit: 30, dev: 25 },
  { key: 'Cl2', label: 'Chlorine Gas', type: 'stack', unit: 'mg/Nm³', limit: 15, dev: 25 },
  { key: 'VOC', label: 'Volatile Organic Compounds', type: 'stack', unit: 'mg/Nm³', limit: 20, dev: 25 },
  { key: 'Fluoride', label: 'Fluoride', type: 'etp', unit: 'mg/L', limit: 2, dev: 50 },
  { key: 'DO', label: 'Dissolved Oxygen', type: 'etp', unit: 'mg/L', limit: 4, dev: 50 },
  { key: 'Turbidity', label: 'Turbidity', type: 'etp', unit: 'NTU', limit: 10, dev: 50 },
  { key: 'Color', label: 'Water Color', type: 'etp', unit: 'Hazen', limit: 150, dev: 50 },
  { key: 'Mercury', label: 'Mercury (Hg)', type: 'etp', unit: 'mg/L', limit: 0.01, dev: 50 },
  { key: 'H2S', label: 'Hydrogen Sulphide', type: 'stack', unit: 'mg/Nm³', limit: 10, dev: 25 },
  { key: 'O3', label: 'Ozone', type: 'ambient', unit: 'µg/m³', limit: 100, dev: 50 },
];

const INITIAL_FORM = {
  key: '',
  label: '',
  type: 'stack',
  unit: 'mg/Nm³',
  limit: 50,
  dev: 25,
  pid: '',
  ph: false,
  min: 6.5,
  attachTarget: 'none',
};

export default function Parameters() {
  const { sites, updateSite } = useData();
  const [tick, setTick] = useState(0);

  // Filter & Search
  const [filterType, setFilterType] = useState('all'); // 'all' | 'stack' | 'ambient' | 'etp' | 'custom'
  const [search, setSearch] = useState('');

  // Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  // Sync on window custom event
  useEffect(() => {
    loadCustomParams();
    const onParamsUpdated = () => setTick((t) => t + 1);
    window.addEventListener('sz-params-updated', onParamsUpdated);
    return () => window.removeEventListener('sz-params-updated', onParamsUpdated);
  }, []);

  const triggerRefresh = () => {
    setTick((t) => t + 1);
  };

  const counts = useMemo(() => {
    let stack = 0;
    let ambient = 0;
    let etp = 0;
    let custom = 0;

    // react to tick update
    if (tick < 0) return { all: 0, stack: 0, ambient: 0, etp: 0, custom: 0 };

    Object.entries(PARAMS).forEach(([, n]) => {
      if (n.type === 'stack') stack++;
      else if (n.type === 'ambient') ambient++;
      else if (n.type === 'etp') etp++;
      if (n.isCustom) custom++;
    });

    return { all: Object.keys(PARAMS).length, stack, ambient, etp, custom };
  }, [tick]);

  const filteredEntries = useMemo(() => {
    if (tick < 0) return [];
    const q = search.trim().toLowerCase();
    return Object.entries(PARAMS).filter(([k, n]) => {
      if (filterType === 'stack' && n.type !== 'stack') return false;
      if (filterType === 'ambient' && n.type !== 'ambient') return false;
      if (filterType === 'etp' && n.type !== 'etp') return false;
      if (filterType === 'custom' && !n.isCustom) return false;

      if (!q) return true;
      return (
        k.toLowerCase().includes(q) ||
        (n.label && n.label.toLowerCase().includes(q)) ||
        (n.unit && n.unit.toLowerCase().includes(q)) ||
        (n.pid && n.pid.toLowerCase().includes(q))
      );
    });
  }, [filterType, search, tick]);

  const applyPreset = (preset) => {
    setForm((prev) => ({
      ...prev,
      key: preset.key,
      label: preset.label,
      type: preset.type,
      unit: preset.unit,
      limit: preset.limit,
      dev: preset.dev,
      pid: `P-${preset.key.toUpperCase()}`,
      ph: false,
    }));
  };

  const handleKeyChange = (val) => {
    const clean = val.toUpperCase().replace(/[^A-Z0-9_.]/g, '');
    setForm((prev) => ({
      ...prev,
      key: clean,
      pid: clean ? `P-${clean}` : '',
    }));
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!form.key.trim()) {
      toast.error('Parameter key is required (e.g. NH3)');
      return;
    }
    if (!form.label.trim()) {
      toast.error('Parameter display name is required');
      return;
    }
    const cleanKey = form.key.trim().toUpperCase().replace(/[^A-Z0-9_.]/g, '');
    const limitNum = parseFloat(form.limit);
    if (isNaN(limitNum)) {
      toast.error('Please enter a valid numeric limit');
      return;
    }

    setSaving(true);
    try {
      const newParam = {
        key: cleanKey,
        label: form.label.trim(),
        type: form.type,
        unit: form.unit.trim(),
        limit: limitNum,
        dev: parseFloat(form.dev) || 25,
        pid: (form.pid || `P-${cleanKey}`).trim().toUpperCase(),
        ph: form.ph,
        min: form.ph ? (parseFloat(form.min) || 6.5) : undefined,
      };

      saveCustomParam(newParam);

      // Optionally attach to site(s)
      if (form.attachTarget === 'all' && sites && sites.length) {
        let count = 0;
        for (const s of sites) {
          const existing = (s.params || []).some((p) => p.key === cleanKey);
          if (!existing) {
            const updatedParams = [
              ...(s.params || []),
              {
                key: cleanKey,
                name: newParam.label,
                pid: `${s.id}-${newParam.pid.replace(/^P-/, '')}`,
                unit: newParam.unit,
                limit: newParam.limit,
                value: +(newParam.limit * (0.35 + Math.random() * 0.35)).toFixed(1),
                signal: 'green',
                updatedAt: new Date().toISOString(),
                lastData: 'just now',
                history: [],
              },
            ];
            if (updateSite) {
              await updateSite(s.id, { params: updatedParams });
              count++;
            }
          }
        }
        toast.success(`Parameter ${cleanKey} registered and added to ${count} sites!`);
      } else if (form.attachTarget && form.attachTarget !== 'none') {
        const targetSite = sites.find((s) => s.id === form.attachTarget);
        if (targetSite) {
          const existing = (targetSite.params || []).some((p) => p.key === cleanKey);
          if (!existing) {
            const updatedParams = [
              ...(targetSite.params || []),
              {
                key: cleanKey,
                name: newParam.label,
                pid: `${targetSite.id}-${newParam.pid.replace(/^P-/, '')}`,
                unit: newParam.unit,
                limit: newParam.limit,
                value: +(newParam.limit * (0.35 + Math.random() * 0.35)).toFixed(1),
                signal: 'green',
                updatedAt: new Date().toISOString(),
                lastData: 'just now',
                history: [],
              },
            ];
            if (updateSite) {
              await updateSite(targetSite.id, { params: updatedParams });
              toast.success(`Parameter ${cleanKey} registered and attached to ${targetSite.name}`);
            }
          } else {
            toast.success(`Parameter ${cleanKey} registered (already monitored on ${targetSite.name})`);
          }
        }
      } else {
        toast.success(`Parameter ${cleanKey} registered successfully!`);
      }

      triggerRefresh();
      setShowAddModal(false);
      setForm(INITIAL_FORM);
    } catch (err) {
      toast.error('Failed to save parameter: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (key) => {
    if (window.confirm(`Are you sure you want to remove custom parameter "${key}" from the registry?`)) {
      deleteCustomParam(key);
      triggerRefresh();
      toast.success(`Parameter ${key} removed`);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Monitoring Parameters</div>
          <div className="page-sub">
            <span>{counts.all} parameters registered</span>
            <span>·</span>
            <span>Param ID = SITE-CODE + suffix</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={() => {
              setForm(INITIAL_FORM);
              setShowAddModal(true);
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            <span>Add Parameter Manually</span>
          </button>
        </div>
      </div>

      <Panel
        title="Parameter Registry"
        hint="Continuous emission and effluent monitoring definitions"
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="input"
              placeholder="Search parameters..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ height: 32, fontSize: 12, width: 170 }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setForm(INITIAL_FORM);
                setShowAddModal(true);
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <span>+</span>
              <span>Add Parameter</span>
            </button>
          </div>
        }
        body="flush"
      >
        {/* Filter Tabs */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-2)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', background: 'var(--surface-2)' }}>
          <button
            className={`btn btn-sm ${filterType === 'all' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: 11, padding: '2px 9px', height: 24 }}
            onClick={() => setFilterType('all')}
          >
            All ({counts.all})
          </button>
          <button
            className={`btn btn-sm ${filterType === 'stack' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: 11, padding: '2px 9px', height: 24 }}
            onClick={() => setFilterType('stack')}
          >
            Emission / Stack ({counts.stack})
          </button>
          <button
            className={`btn btn-sm ${filterType === 'ambient' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: 11, padding: '2px 9px', height: 24 }}
            onClick={() => setFilterType('ambient')}
          >
            Ambient Air ({counts.ambient})
          </button>
          <button
            className={`btn btn-sm ${filterType === 'etp' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: 11, padding: '2px 9px', height: 24 }}
            onClick={() => setFilterType('etp')}
          >
            Effluent / ETP ({counts.etp})
          </button>
          {counts.custom > 0 && (
            <button
              className={`btn btn-sm ${filterType === 'custom' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '2px 9px', height: 24 }}
              onClick={() => setFilterType('custom')}
            >
              ★ Custom Added ({counts.custom})
            </button>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>ID Suffix</th>
                <th>Key</th>
                <th>Name</th>
                <th>Type</th>
                <th>Limit</th>
                <th>Deviation</th>
                <th>Origin</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map(([k, n]) => {
                const suffix = (n.pid || 'P-' + k.toUpperCase()).replace(/^P-/, '');
                return (
                  <tr key={k}>
                    <td className="mono">
                      <b>{suffix}</b>
                    </td>
                    <td>
                      <b>{k}</b>
                    </td>
                    <td>{n.label || '—'}</td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background:
                            n.type === 'stack'
                              ? 'var(--accent)'
                              : n.type === 'ambient'
                              ? 'var(--info, #0284c7)'
                              : 'var(--primary)',
                          color: '#ffffff',
                          fontSize: 10,
                        }}
                      >
                        {n.type === 'stack'
                          ? 'Emission'
                          : n.type === 'ambient'
                          ? 'Ambient'
                          : 'Effluent'}
                      </span>
                    </td>
                    <td className="mono">
                      {n.ph ? `${n.min ?? 6.5}–${n.limit}` : `≤ ${n.limit} ${n.unit || ''}`}
                    </td>
                    <td className="mono">
                      {n.ph ? 'pH <4 / >12' : `±${n.dev}%`}
                    </td>
                    <td>
                      {n.isCustom ? (
                        <span
                          className="badge"
                          style={{
                            background: 'var(--primary-soft, rgba(16, 185, 129, 0.12))',
                            color: 'var(--primary)',
                            border: '1px solid var(--primary-glow)',
                            fontSize: 10,
                          }}
                        >
                          Manual / Custom
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>CPCB Standard</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {n.isCustom ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--st-red, #ef4444)', padding: '2px 8px', fontSize: 11 }}
                          onClick={() => handleDelete(k)}
                          title={`Delete custom parameter ${k}`}
                        >
                          🗑 Delete
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Locked</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredEntries.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--ink-3)' }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>🔍</div>
              <div style={{ fontWeight: 600, color: 'var(--ink)' }}>No parameters found</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                No parameters match &ldquo;{search}&rdquo;
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setSearch('');
                  setShowAddModal(true);
                }}
                style={{ marginTop: 12 }}
              >
                + Add Parameter Manually
              </button>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="How parameters work">
        <div style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.75 }}>
          <p>
            Every site gets its own <b>Param ID</b> formed as{' '}
            <code
              style={{
                fontFamily: 'var(--font-mono)',
                background: 'var(--surface-2)',
                padding: '1px 6px',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              SITE-CODE-SUFFIX
            </code>
            . For example, site <b>ESK-4417</b> with parameter <b>PM</b> gets the ID{' '}
            <b>ESK-4417-PM</b>.
          </p>
          <p style={{ marginTop: 12 }}>
            The datalogger API uses these IDs to identify each channel. The
            CPCB grading engine compares each reading against the parameter&apos;s{' '}
            <b>limit</b> and the <b>deviation band</b> to determine whether the
            parameter is within limits, in warning, or in exceedance.
          </p>
          <p style={{ marginTop: 12 }}>
            <b>Emission</b> parameters are measured at stacks (PM, SOX, NOₓ, CO,
            Flow, Temperature, Pressure). <b>Ambient</b> parameters reflect air quality monitors
            (PM2.5, PM10, Humidity). <b>Effluent</b> parameters are measured
            at ETP outlets (pH, BOD, COD, TSS, TOC).
          </p>
        </div>
      </Panel>

      {/* Add Parameter Modal */}
      <Modal
        open={showAddModal}
        title="Add Monitoring Parameter Manually"
        onClose={() => setShowAddModal(false)}
        width={580}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowAddModal(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save & Register Parameter'}
            </button>
          </div>
        }
      >
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Quick Presets */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6, display: 'block' }}>
              Quick Presets (Industrial CPCB Standards)
            </label>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {PRESETS.map((pr) => (
                <button
                  type="button"
                  key={pr.key}
                  onClick={() => applyPreset(pr)}
                  className={`btn btn-sm ${form.key === pr.key ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: 11, padding: '2px 8px', height: 24 }}
                  title={`${pr.label} · ${pr.limit} ${pr.unit}`}
                >
                  {pr.key}
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-2)', paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 12 }}>
            <div>
              <label>
                Parameter Key <span style={{ color: 'var(--st-red)' }}>*</span>
              </label>
              <input
                type="text"
                className="input"
                placeholder="e.g. NH3, Cl2, VOC"
                value={form.key}
                onChange={(e) => handleKeyChange(e.target.value)}
                autoFocus
                required
              />
              <span style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2, display: 'block' }}>
                Alphanumeric channel code
              </span>
            </div>

            <div>
              <label>
                Display Label / Full Name <span style={{ color: 'var(--st-red)' }}>*</span>
              </label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Ammonia Gas Analyzer"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
            <div>
              <label>Channel / Medium Type</label>
              <select
                className="input"
                value={form.type}
                onChange={(e) => {
                  const newType = e.target.value;
                  const defaultUnit = newType === 'stack' ? 'mg/Nm³' : newType === 'ambient' ? 'µg/m³' : 'mg/L';
                  setForm({ ...form, type: newType, unit: defaultUnit });
                }}
              >
                <option value="stack">Emission / Stack Channel</option>
                <option value="ambient">Ambient Air Quality (AAQMS)</option>
                <option value="etp">Effluent / ETP Outlet</option>
              </select>
            </div>

            <div>
              <label>Measurement Unit</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. mg/Nm³, mg/L"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                list="unit-suggestions"
              />
              <datalist id="unit-suggestions">
                <option value="mg/m3" />
                <option value="mg/Nm³" />
                <option value="mg/L" />
                <option value="µg/m³" />
                <option value="ppm" />
                <option value="ppb" />
                <option value="NTU" />
                <option value="Hazen" />
                <option value="%" />
                <option value="°C" />
                <option value="mmH₂O" />
                <option value="m³/s" />
                <option value="dB" />
              </datalist>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 12 }}>
            <div>
              <label>
                Prescribed Limit <span style={{ color: 'var(--st-red)' }}>*</span>
              </label>
              <input
                type="number"
                step="any"
                className="input mono"
                placeholder="e.g. 50"
                value={form.limit}
                onChange={(e) => setForm({ ...form, limit: e.target.value })}
                required
              />
            </div>

            <div>
              <label>Deviation Band (%)</label>
              <input
                type="number"
                step="1"
                min="0"
                max="200"
                className="input mono"
                placeholder="e.g. 25"
                value={form.dev}
                onChange={(e) => setForm({ ...form, dev: e.target.value })}
              />
            </div>

            <div>
              <label>PID Suffix</label>
              <input
                type="text"
                className="input mono"
                placeholder="e.g. P-NH3"
                value={form.pid}
                onChange={(e) => setForm({ ...form, pid: e.target.value })}
              />
            </div>
          </div>

          {/* pH Checkbox */}
          <div style={{ padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border-2)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={form.ph}
                onChange={(e) => setForm({ ...form, ph: e.target.checked })}
              />
              <span style={{ fontSize: 12, fontWeight: 500 }}>
                This parameter operates on a pH / dual-bound range (Min & Max)
              </span>
            </label>
            {form.ph && (
              <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingLeft: 22 }}>
                <div>
                  <label style={{ fontSize: 11 }}>Min Permissible pH</label>
                  <input
                    type="number"
                    step="0.1"
                    className="input mono"
                    value={form.min}
                    onChange={(e) => setForm({ ...form, min: e.target.value })}
                    style={{ height: 30, width: 90 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11 }}>Max Permissible pH</label>
                  <input
                    type="number"
                    step="0.1"
                    className="input mono"
                    value={form.limit}
                    onChange={(e) => setForm({ ...form, limit: e.target.value })}
                    style={{ height: 30, width: 90 }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Attach to Sites */}
          {sites && sites.length > 0 && (
            <div>
              <label>Optionally Attach to Sites</label>
              <select
                className="input"
                value={form.attachTarget}
                onChange={(e) => setForm({ ...form, attachTarget: e.target.value })}
              >
                <option value="none">Register in CPCB catalog only (do not attach to any site now)</option>
                <option value="all">Attach to all active sites ({sites.length} sites)</option>
                <optgroup label="Attach to specific site:">
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.id})
                    </option>
                  ))}
                </optgroup>
              </select>
              <span style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2, display: 'block' }}>
                Attaching creates an active monitoring channel so live telemetry can be recorded immediately.
              </span>
            </div>
          )}
        </form>
      </Modal>
    </>
  );
}