import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { PARAMS, SIG_LABEL } from '../utils/cpcb';
import Panel from '../components/UI/Panel';
import Modal from '../components/UI/Modal';

/* ============================================================
   Parameter row — key + custom name + limit + +/− buttons
   ============================================================ */
function ParameterRow({ row, index, total, onChange, onRemove, onAdd }) {
  const def = PARAMS[row.key] || {};

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '70px 1.3fr 1.5fr 90px 70px',
        gap: 8,
        alignItems: 'center',
        padding: '10px 12px',
        border: '1px solid var(--border)',
        borderRadius: 10,
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
        onChange={(e) => onChange({ ...row, key: e.target.value })}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
          color: 'var(--ink)',
          fontSize: 13,
          fontFamily: 'inherit',
        }}
      >
        <option value="">— Choose parameter —</option>
        {Object.keys(PARAMS).map((k) => (
          <option key={k} value={k}>
            {k} — {PARAMS[k].label || k}
          </option>
        ))}
      </select>

      <input
        value={row.name}
        onChange={(e) => onChange({ ...row, name: e.target.value })}
        placeholder={
          row.key
            ? 'e.g. Stack 1 ' + row.key
            : 'Custom name (e.g. Boiler Flue PM)'
        }
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
          color: 'var(--ink)',
          fontSize: 13,
          fontFamily: 'inherit',
        }}
      />

      <input
        type="number"
        step="any"
        value={row.limit}
        onChange={(e) => onChange({ ...row, limit: +e.target.value })}
        placeholder="Limit"
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
          color: 'var(--ink)',
          fontSize: 13,
          fontFamily: 'monospace',
        }}
        title={def.unit ? 'Default limit ' + def.limit + ' ' + def.unit : ''}
      />

      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onAdd}
          title="Add another parameter"
          style={{ padding: '6px 8px', minWidth: 30 }}
        >
          ＋
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onRemove}
          disabled={total <= 1}
          title="Remove this parameter"
          style={{ padding: '6px 8px', minWidth: 30 }}
        >
          −
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   Email row — one email input with − button
   ============================================================ */
function EmailRow({ value, onChange, onRemove }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        marginBottom: 8,
        alignItems: 'center',
      }}
    >
      <input
        type="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. owner@company.com"
        style={{
          flex: 1,
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
          color: 'var(--ink)',
          fontSize: 13,
          fontFamily: 'inherit',
        }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={onRemove}
        title="Remove this email"
        style={{ padding: '6px 12px', minWidth: 44 }}
      >
        −
      </button>
    </div>
  );
}

/* ============================================================
   Main component
   ============================================================ */
export default function AddSite() {
  const { session } = useAuth();
  const { sites, createSite, updateSite, deleteSite, patchSiteState } = useData();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const isAdmin = session?.role === 'admin';

  const list = useMemo(() => {
    if (!search.trim()) return sites;
    const q = search.toLowerCase();
    return sites.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.sector || '').toLowerCase().includes(q)
    );
  }, [sites, search]);

  const toggleState = async (s, field) => {
    try {
      await patchSiteState(s.id, { [field]: !s[field] });
      toast.success(s.name + ' ' + field + ' toggled.');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const removeSite = async (s) => {
    if (!window.confirm('Delete ' + s.name + '? This removes all its data.')) return;
    try {
      await deleteSite(s.id);
      toast.success(s.name + ' deleted.');
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">
            {isAdmin ? 'Manage Sites' : 'Add / Edit Sites'}
          </div>
          <div className="page-sub">
            <span>
              {isAdmin
                ? 'Start/stop · visibility · edit · delete'
                : 'Register & edit site details'}
            </span>
          </div>
        </div>

        <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
          Register new site
        </button>
      </div>

      <Panel
        title="All Sites"
        hint={list.length + ' shown'}
        right={
          <input
            className="search"
            placeholder="Search by site name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
        body="flush"
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Site</th>
                <th>Code</th>
                <th>Status</th>
                {isAdmin && <th>Data feed</th>}
                {isAdmin && <th>Visibility</th>}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 4}>
                    <div className="empty">No site matches your search.</div>
                  </td>
                </tr>
              ) : (
                list.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.name}</b>
                      <br />
                      <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>
                        {(s.sector || '-') + ' | ' + (s.loc || '-')}
                      </span>
                    </td>
                    <td className="mono">{s.id}</td>
                    <td>
                      <span className="status-pill">
                        <span className={'status-dot ' + s.signal}></span>
                        {SIG_LABEL[s.signal]}
                      </span>
                    </td>
                    {isAdmin && (
                      <td>
                        <button
                          className={'btn btn-sm ' + (s.running ? 'btn-ghost' : 'btn-primary')}
                          onClick={() => toggleState(s, 'running')}
                        >
                          {s.running ? 'Stop' : 'Start'}
                        </button>
                      </td>
                    )}
                    {isAdmin && (
                      <td>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => toggleState(s, 'enabled')}
                        >
                          {s.enabled ? 'Visible' : 'Hidden'}
                        </button>
                      </td>
                    )}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setEditing(s)}
                      >
                        Edit
                      </button>
                      {isAdmin && (
                        <button
                          className="btn btn-sm btn-danger"
                          style={{ marginLeft: 6 }}
                          onClick={() => removeSite(s)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {editing && (
        <SiteForm
          existing={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSubmit={async (body, isEdit) => {
            try {
              if (isEdit) await updateSite(body.id, body);
              else await createSite(body);
              toast.success(isEdit ? 'Site updated.' : 'Site registered.');
              setEditing(null);
            } catch (e) {
              toast.error(e.message || 'Failed');
            }
          }}
        />
      )}
    </>
  );
}

/* ============================================================
   Site form
   ============================================================ */
function SiteForm({ existing, onClose, onSubmit }) {
  const initialRows = existing?.params?.length
    ? existing.params.map((p, i) => ({
        key: p.key,
        name: p.name || p.key + ' ' + (i + 1),
        limit: p.limit ?? PARAMS[p.key]?.limit ?? 100,
      }))
    : [{ key: '', name: '', limit: 0 }];

  /* Normalize existing emails to an array of strings */
  const initialEmails = Array.isArray(existing?.notifyEmails)
    ? existing.notifyEmails
    : [];

  const [form, setForm] = useState({
    name: existing?.name || '',
    id: existing?.id || '',
    sector: existing?.sector || '',
    loc: existing?.loc || '',
    lat: existing?.lat ?? 28.6,
    lng: existing?.lng ?? 77.2,
    spcb: existing?.spcb || 'HSPCB',
    category: existing?.category || '17-Category',
    stacks: existing?.stacks ?? 1,
    etp: existing?.etp ?? 1,
    contact: existing?.contact || '',
    phone: existing?.phone || '',
    passcode: existing?.passcode || '',
    notifyEmails: initialEmails,                  // ← per-site alert emails
    rows: initialRows,
  });
  const [busy, setBusy] = useState(false);

  /* ---- Parameter row handlers ---- */

  /**
   * Update a parameter row.
   * Only auto-fills the default name when:
   *   - the key changed AND
   *   - the user hasn't already typed a custom name
   * This preserves any custom name the user has entered.
   */
  const updateRow = (idx, next) => {
    setForm((f) => {
      const rows = [...f.rows];
      const prev = rows[idx];
      const keyChanged = next.key && next.key !== prev.key;

      // Was the previous name auto-generated (or empty)?
      const prevAutoName =
        !prev.name ||
        prev.name === (prev.key ? prev.key + ' ' + (idx + 1) : '');

      if (keyChanged && prevAutoName) {
        const def = PARAMS[next.key] || {};
        next.name = next.key ? next.key + ' ' + (idx + 1) : '';
        if (!next.limit || next.limit === 0) {
          next.limit = def.limit ?? 0;
        }
      }

      rows[idx] = next;
      return { ...f, rows };
    });
  };

  const addRow = () => {
    setForm((f) => ({
      ...f,
      rows: [...f.rows, { key: '', name: '', limit: 0 }],
    }));
  };

  const removeRow = (idx) => {
    setForm((f) => {
      if (f.rows.length <= 1) return f;
      return { ...f, rows: f.rows.filter((_, i) => i !== idx) };
    });
  };

  /* ---- Email row handlers ---- */
  const addEmailRow = () => {
    setForm((f) => ({
      ...f,
      notifyEmails: [...(f.notifyEmails || []), ''],
    }));
  };

  const updateEmailRow = (idx, value) => {
    setForm((f) => {
      const list = [...(f.notifyEmails || [])];
      list[idx] = value;
      return { ...f, notifyEmails: list };
    });
  };

  const removeEmailRow = (idx) => {
    setForm((f) => ({
      ...f,
      notifyEmails: (f.notifyEmails || []).filter((_, i) => i !== idx),
    }));
  };

  /* ---- Submit ---- */
  const submit = async () => {
    if (!form.name.trim() || !form.id.trim()) {
      toast.error('Site name and code are required.');
      return;
    }

    /* Passcode is mandatory — no default */
    const passcode = (form.passcode || '').trim();
    if (!passcode) {
      toast.error('Industry passcode is required.');
      return;
    }
    if (passcode.length < 4) {
      toast.error('Passcode must be at least 4 characters.');
      return;
    }

    const validRows = form.rows.filter(
      (r) => r.key && r.limit !== undefined
    );
    if (!validRows.length) {
      toast.error('Add at least one parameter.');
      return;
    }

    const siteCode = form.id.trim().toUpperCase();

    const params = validRows.map((r, i) => {
      const def = PARAMS[r.key] || {};
      const customName = (r.name || '').trim();
      return {
        key: r.key,
        name: customName || (r.key + ' ' + (i + 1)),
        pid:
          siteCode +
          '-' +
          r.key.toUpperCase().replace(/[^A-Z0-9]/g, '') +
          '-' +
          (i + 1),
        value: 0,
        unit: def.unit || '',
        limit: r.limit,
        min: def.min ?? null,
        history: [],
        signal: 'green',
        yToday: 0,
        y30: 0,
        connHrs: 0,
        stableHrs: 0,
        excStreak: 0,
      };
    });

    /* Validate & clean emails */
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanedEmails = (form.notifyEmails || [])
      .map((e) => String(e).trim().toLowerCase())
      .filter(Boolean);

    const invalid = cleanedEmails.find((e) => !emailRegex.test(e));
    if (invalid) {
      toast.error(`Invalid email: ${invalid}`);
      return;
    }

    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        id: siteCode,
        sector: form.sector || '-',
        loc: form.loc || '-',
        lat: +form.lat || 28.6,
        lng: +form.lng || 77.2,
        spcb: form.spcb,
        category: form.category,
        stacks: +form.stacks || 0,
        etp: +form.etp || 0,
        contact: form.contact || '-',
        phone: form.phone || '-',
        passcode,
        ganga: form.category.includes('Ganga'),
        notifyEmails: cleanedEmails,
        params,
      };
      await onSubmit(body, !!existing);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={true}
      title={existing ? 'Edit Site' : 'Register New Site'}
      onClose={onClose}
      width={780}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving...' : existing ? 'Save changes' : 'Register site'}
          </button>
        </>
      }
    >
      {/* ---------- Site details ---------- */}
      <div className="form-grid">
        <div className="fg">
          <label>
            Site name <span className="req">*</span>
          </label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>

        <div className="fg">
          <label>
            Industry code <span className="req">*</span>
          </label>
          <input
            value={form.id}
            disabled={!!existing}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            placeholder="e.g. ABC-1234"
          />
        </div>

        <div className="fg">
          <label>Sector</label>
          <input
            value={form.sector}
            onChange={(e) => setForm({ ...form, sector: e.target.value })}
          />
        </div>

        <div className="fg">
          <label>Location</label>
          <input
            value={form.loc}
            onChange={(e) => setForm({ ...form, loc: e.target.value })}
          />
        </div>

        <div className="fg">
          <label>Latitude</label>
          <input
            type="number"
            step="any"
            value={form.lat}
            onChange={(e) => setForm({ ...form, lat: +e.target.value })}
          />
        </div>

        <div className="fg">
          <label>Longitude</label>
          <input
            type="number"
            step="any"
            value={form.lng}
            onChange={(e) => setForm({ ...form, lng: +e.target.value })}
          />
        </div>

        <div className="fg">
          <label>SPCB</label>
          <select
            value={form.spcb}
            onChange={(e) => setForm({ ...form, spcb: e.target.value })}
          >
            {['HSPCB', 'UPPCB', 'DPCC', 'RSPCB', 'PPCB', 'CPCB', 'Other'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>

        <div className="fg">
          <label>Category</label>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {['17-Category', 'GPI in Ganga', 'Other'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>

        <div className="fg">
          <label>Stacks</label>
          <input
            type="number"
            min="0"
            value={form.stacks}
            onChange={(e) => setForm({ ...form, stacks: +e.target.value })}
          />
        </div>

        <div className="fg">
          <label>ETP outlets</label>
          <input
            type="number"
            min="0"
            value={form.etp}
            onChange={(e) => setForm({ ...form, etp: +e.target.value })}
          />
        </div>

        <div className="fg">
          <label>Contact person</label>
          <input
            value={form.contact}
            onChange={(e) => setForm({ ...form, contact: e.target.value })}
          />
        </div>

        <div className="fg">
          <label>Alert mobile / email</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>

        {/* ---------- Manual passcode ---------- */}
        <div className="fg">
          <label>
            Industry Passcode <span className="req">*</span>
          </label>
          <input
            type="text"
            value={form.passcode}
            onChange={(e) => setForm({ ...form, passcode: e.target.value })}
            placeholder="Enter a passcode (min 4 characters)"
            autoComplete="off"
          />
          <div className="hint">
            Required. This is what the industry enters to log in with the
            site code. There is <b>no default</b> — you must set it manually.
          </div>
        </div>

        {/* Empty cell to keep the grid aligned */}
        <div className="fg"></div>
      </div>

      {/* ---------- Notification emails ---------- */}
      <div
        style={{
          marginTop: 24,
          paddingTop: 18,
          borderTop: '1px solid var(--border-2)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <div>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Alert notification emails{' '}
              <span style={{ color: 'var(--mute)', fontWeight: 400 }}>
                (optional)
              </span>
            </label>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
              Add one or more emails. Alerts and offline notifications for this
              site will be sent to these addresses. Leave empty if this site
              should not receive emails.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={addEmailRow}
          >
            ＋ Add email
          </button>
        </div>

        {(form.notifyEmails || []).length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--ink-3)',
              padding: '12px 14px',
              border: '1px dashed var(--border)',
              borderRadius: 8,
              background: 'var(--surface)',
            }}
          >
            No emails added — this site will not receive email alerts.
          </div>
        ) : (
          (form.notifyEmails || []).map((email, idx) => (
            <EmailRow
              key={idx}
              value={email}
              onChange={(val) => updateEmailRow(idx, val)}
              onRemove={() => removeEmailRow(idx)}
            />
          ))
        )}
      </div>

      {/* ---------- Parameters ---------- */}
      <div
        style={{
          marginTop: 24,
          paddingTop: 18,
          borderTop: '1px solid var(--border-2)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <div>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Monitored Parameters <span className="req">*</span>{' '}
              <span style={{ color: 'var(--mute)', fontWeight: 400 }}>
                ({form.rows.length} configured)
              </span>
            </label>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
              The same parameter type can be added multiple times — give each one a distinct name
              (e.g. "Stack 1 PM" and "Stack 2 PM").
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={addRow}
          >
            ＋ Add parameter
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '70px 1.3fr 1.5fr 90px 70px',
            gap: 8,
            padding: '0 12px 6px',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '.05em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
          }}
        >
          <span>#</span>
          <span>Parameter</span>
          <span>Custom Name</span>
          <span>Limit</span>
          <span></span>
        </div>

        {form.rows.map((row, idx) => (
          <ParameterRow
            key={idx}
            row={row}
            index={idx}
            total={form.rows.length}
            onChange={(next) => updateRow(idx, next)}
            onAdd={addRow}
            onRemove={() => removeRow(idx)}
          />
        ))}
      </div>
    </Modal>
  );
}