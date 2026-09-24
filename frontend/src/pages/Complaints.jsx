import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { timeAgo } from '../utils/formatters';
import Panel from '../components/UI/Panel';
import Modal from '../components/UI/Modal';
import EngineerCard from '../components/UI/EngineerCard';

const CATEGORIES = ['Equipment', 'Data', 'Calibration', 'Connectivity', 'Service', 'Other'];

const STATUS_TABS = [
  { key: 'all',      label: 'All' },
  { key: 'open',     label: 'Open' },
  { key: 'progress', label: 'In Progress' },
  { key: 'resolved', label: 'Resolved' },
];

/* status -> dot colour */
const statusDot = (s) => {
  if (s === 'open') return 'orange';
  if (s === 'progress') return 'yellow';
  if (s === 'resolved') return 'green';
  return 'grey';
};

export default function Complaints({ mine = false }) {
  const { session } = useAuth();
  const { complaints, sites, createComplaint, updateComplaint } = useData();

  /* ---- Read ?status= from the URL ---- */
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status') || 'all';

  /* Local fallback state so first render is stable */
  const [status, setStatus] = useState(urlStatus);

  /* Keep local state in sync when URL changes (e.g. sidebar click) */
  useEffect(() => {
    setStatus(urlStatus);
  }, [urlStatus]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ cat: 'Equipment', msg: '' });
  const [busy, setBusy] = useState(false);

  const site = mine ? sites.find((s) => s.id === session?.siteId) : null;

  /* ---- Base list: filter by "mine" first ---- */
  const baseList = useMemo(() => {
    if (!mine) return complaints;
    return complaints.filter((c) => c.siteId === (site && site.id));
  }, [complaints, mine, site]);

  /* ---- Status counts (for tab badges) ---- */
  const counts = useMemo(() => {
    const c = { all: baseList.length, open: 0, progress: 0, resolved: 0 };
    baseList.forEach((x) => {
      if (c[x.status] != null) c[x.status]++;
    });
    return c;
  }, [baseList]);

  /* ---- Filtered list by status ---- */
  const list = useMemo(() => {
    if (status === 'all') return baseList;
    return baseList.filter((c) => c.status === status);
  }, [baseList, status]);

  /* ---- When user clicks a chip, update both state and URL ---- */
  const changeStatus = (next) => {
    setStatus(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    setSearchParams(params, { replace: true });
  };

  /* ---- Listen for global "open support" event from Topbar ---- */
  useEffect(() => {
    const fn = () => setOpen(true);
    window.addEventListener('open-support', fn);
    return () => window.removeEventListener('open-support', fn);
  }, []);

  /* ---- Submit new complaint ---- */
  const submit = async () => {
    if (!form.msg.trim()) {
      toast.error('Please describe the issue.');
      return;
    }
    setBusy(true);
    try {
      await createComplaint({
        siteId: site ? site.id : '—',
        site: site ? site.name : '—',
        cat: form.cat,
        msg: form.msg,
        by: session?.role === 'industry' ? site?.name || 'industry' : session?.name,
      });
      toast.success('Complaint raised. Engineer will follow up.');
      setForm({ cat: 'Equipment', msg: '' });
      setOpen(false);
    } catch (e) {
      toast.error(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  /* ---- Change status of a complaint (admin/engineer only) ---- */
  const updateStatus = async (id, next) => {
    try {
      await updateComplaint(id, { status: next });
      toast.success('Complaint updated.');
    } catch (e) {
      toast.error(e.message || 'Failed');
    }
  };

  const canManage = !mine && ['admin', 'engineer'].includes(session?.role);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{mine ? 'My Complaints' : 'Complaints'}</div>
          <div className="page-sub">
            <span>
              {status === 'all'
                ? `${list.length} total`
                : `${list.length} ${STATUS_TABS.find((t) => t.key === status)?.label.toLowerCase()}`}
            </span>
          </div>
        </div>

        <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
          ＋ Raise Complaint
        </button>
      </div>

      {/* Engineer contact */}
      <Panel title="Your service engineer">
        <EngineerCard />
      </Panel>

      <Panel
        title={mine ? 'My Complaints' : 'All Complaints'}
        right={
          <div className="chips">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                className={'chip' + (status === t.key ? ' on' : '')}
                onClick={() => changeStatus(t.key)}
              >
                {t.label}
                {counts[t.key] > 0 && (
                  <span
                    style={{
                      marginLeft: 4,
                      opacity: 0.7,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                    }}
                  >
                    {counts[t.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
        }
        body="flush"
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>ID</th>
                <th>Site</th>
                <th>Category</th>
                <th style={{ width: '32%' }}>Issue</th>
                <th>Raised</th>
                <th>Status</th>
                {canManage && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 7 : 6}>
                    <div className="empty">
                      {status === 'all'
                        ? 'No complaints yet.'
                        : `No ${STATUS_TABS.find((t) => t.key === status)?.label.toLowerCase()} complaints.`}
                    </div>
                  </td>
                </tr>
              ) : (
                list.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.id}</td>
                    <td>
                      <b>{c.site}</b>
                    </td>
                    <td>{c.cat}</td>
                    <td style={{ color: 'var(--ink-2)' }}>{c.msg}</td>
                    <td
                      style={{
                        color: 'var(--ink-3)',
                        fontSize: 12,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {timeAgo(c.time)}
                    </td>
                    <td>
                      <span className="status-pill">
                        <span className={'status-dot ' + statusDot(c.status)}></span>
                        {c.status}
                      </span>
                    </td>
                    {canManage && (
                      <td>
                        <select
                          value={c.status}
                          onChange={(e) => updateStatus(c.id, e.target.value)}
                          style={{
                            padding: '5px 8px',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            color: 'var(--ink)',
                            fontSize: 12,
                          }}
                        >
                          <option value="open">Open</option>
                          <option value="progress">In Progress</option>
                          <option value="resolved">Resolved</option>
                        </select>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Raise complaint modal */}
      <Modal
        open={open}
        title="Raise a Complaint"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={busy}
            >
              {busy ? 'Submitting…' : 'Submit complaint'}
            </button>
          </>
        }
      >
        <EngineerCard />

        <div className="fg" style={{ marginTop: 16, marginBottom: 12 }}>
          <label>Site</label>
          <input
            value={site ? `${site.name} (${site.id})` : 'Select after login'}
            disabled
          />
        </div>

        <div className="fg" style={{ marginBottom: 12 }}>
          <label>
            Category <span className="req">*</span>
          </label>
          <select
            value={form.cat}
            onChange={(e) => setForm({ ...form, cat: e.target.value })}
          >
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="fg">
          <label>
            Describe the issue <span className="req">*</span>
          </label>
          <textarea
            value={form.msg}
            onChange={(e) => setForm({ ...form, msg: e.target.value })}
            placeholder="What's the problem? Include analyzer/stack ID if relevant."
          />
        </div>
      </Modal>
    </>
  );
}