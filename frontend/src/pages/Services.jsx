import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import {
  serviceStatus,
  serviceLabel,
  siteServiceAlert,
} from '../utils/serviceHelpers';
import { fmtDay } from '../utils/formatters';
import Panel from '../components/UI/Panel';
import KPI from '../components/UI/KPI';
import Modal from '../components/UI/Modal';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { useTheme } from '../context/ThemeContext';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend
);

export default function Services() {
  const { sites, renewContract } = useData();
  const { session } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [q, setQ] = useState('');
  const [manageSite, setManageSite] = useState(null);

  const canManage = session?.role === 'admin' || session?.role === 'sales';

  const tally = useMemo(() => {
    const t = { expired: 0, week: 0, d15: 0, m1: 0, m2: 0, ok: 0 };
    sites.forEach((s) => {
      const a = siteServiceAlert(s);
      if (a && t[a.code] != null) t[a.code]++;
    });
    return t;
  }, [sites]);

  const list = useMemo(() => {
    if (!q.trim()) return sites;
    const ql = q.toLowerCase();
    return sites.filter(
      (s) => s.name.toLowerCase().includes(ql) || s.id.toLowerCase().includes(ql)
    );
  }, [sites, q]);

  const revenue = useMemo(() => {
    const rev = {};
    sites.forEach((s) => {
      if (!s.services) return;
      Object.keys(s.services).forEach((k) => {
        const c = s.services[k];
        if (!c || c.suspended) return;
        const st = serviceStatus(c);
        if (st.code === 'expired' || st.code === 'none') return;
        const group = k.split('|')[0];
        const tier = (s.catalogue?.[group]?.tiers || []).find((t) => t.id === c.package);
        rev[group] = (rev[group] || 0) + (tier ? tier.price : 0);
      });
    });
    return rev;
  }, [sites]);

  const statusCounts = useMemo(() => {
    const sc = { Active: 0, '≤2 mo': 0, '≤1 mo': 0, '≤1 wk': 0, Suspended: 0 };
    sites.forEach((s) => {
      if (!s.services) return;
      Object.values(s.services).forEach((c) => {
        if (!c) return;
        const st = serviceStatus(c);
        if (st.code === 'suspended') sc.Suspended++;
        else if (st.code === 'ok') sc.Active++;
        else if (st.code === 'm2') sc['≤2 mo']++;
        else if (st.code === 'm1' || st.code === 'd15') sc['≤1 mo']++;
        else if (st.code === 'week' || st.code === 'expired') sc['≤1 wk']++;
      });
    });
    return sc;
  }, [sites]);

  /* ----- chart theme ----- */
  const surface = isDark ? '#131a1c' : '#ffffff';
  const ink = isDark ? '#e8eeef' : '#0d1b1e';
  const inkSoft = isDark ? '#7b8a8d' : '#6b7a7d';
  const grid = isDark ? '#223032' : '#e8edee';

  const revPalette = isDark
    ? ['#2dd4bf', '#22d3ee', '#a78bfa', '#fbbf24', '#fb923c', '#f87171']
    : ['#0f766e', '#0891b2', '#7c3aed', '#d97706', '#ea580c', '#dc2626'];

  const revData = {
    labels: Object.keys(revenue),
    datasets: [
      {
        data: Object.values(revenue),
        backgroundColor: Object.keys(revenue).map((_, i) => revPalette[i % revPalette.length]),
        borderRadius: 6,
        barThickness: 32,
      },
    ],
  };
  const revOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: surface,
        titleColor: ink,
        bodyColor: ink,
        borderColor: grid,
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
        callbacks: { label: (c) => '₹' + c.parsed.y.toLocaleString('en-IN') },
        titleFont: { size: 12, weight: '600' },
        bodyFont: { size: 12, family: 'JetBrains Mono' },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: grid, drawBorder: false },
        ticks: {
          color: inkSoft,
          font: { size: 11, family: 'JetBrains Mono' },
          callback: (v) => '₹' + v / 1000 + 'k',
        },
      },
      x: { grid: { display: false }, ticks: { color: inkSoft, font: { size: 11 } } },
    },
  };

  const statData = {
    labels: Object.keys(statusCounts),
    datasets: [
      {
        data: Object.values(statusCounts),
        backgroundColor: isDark
          ? ['#10b981', '#f59e0b', '#fb923c', '#f87171', '#94a3b8']
          : ['#059669', '#d97706', '#ea580c', '#dc2626', '#64748b'],
        borderWidth: 2,
        borderColor: surface,
      },
    ],
  };
  const statOpts = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '68%',
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: inkSoft,
          boxWidth: 8,
          boxHeight: 8,
          padding: 12,
          font: { size: 11, weight: '500' },
          usePointStyle: true,
          pointStyle: 'circle',
        },
      },
      tooltip: {
        backgroundColor: surface,
        titleColor: ink,
        bodyColor: ink,
        borderColor: grid,
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
      },
    },
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Service Contracts</div>
          <div className="page-sub">
            <span>DTC · AMC · CMC</span>
            <span>·</span>
            <span>{sites.length} industries</span>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpis">
        <KPI color="r"  label="Expired"    value={tally.expired} desc="Renew immediately" />
        <KPI color="r"  label="≤ 1 week"   value={tally.week}    desc="Critical" />
        <KPI color="o"  label="≤ 15 days"  value={tally.d15}     desc="Due soon" />
        <KPI color="o"  label="≤ 1 month"  value={tally.m1}      desc="Upcoming" />
        <KPI color="y"  label="≤ 2 months" value={tally.m2}      desc="Plan renewal" />
        <KPI color="g"  label="Active"     value={tally.ok}      desc="In contract" />
      </div>

      {/* Charts */}
      <div className="two-col">
        <Panel title="Contract Value by Service" hint="Sum of active package rates">
          {Object.keys(revenue).length === 0 ? (
            <div className="empty">No active priced contracts yet.</div>
          ) : (
            <div className="chart-wrap chart-md">
              <Bar data={revData} options={revOpts} />
            </div>
          )}
        </Panel>
        <Panel title="Contract Status" hint="Across all industries">
          <div className="chart-wrap chart-md">
            <Doughnut data={statData} options={statOpts} />
          </div>
        </Panel>
      </div>

      {/* Table */}
      <Panel
        title="Industries & Service Contracts"
        hint={canManage ? 'Each industry has its own services & rates' : ''}
        right={
          <input
            className="search"
            placeholder="Search industry…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
        body="flush"
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Industry</th>
                <th>Services</th>
                <th>Active value / yr</th>
                <th>Soonest expiry</th>
                <th>Status</th>
                {canManage && <th>Manage</th>}
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5}>
                    <div className="empty">No industry matches “{q}”.</div>
                  </td>
                </tr>
              ) : (
                list.map((s) => {
                  const keys = s.services ? Object.keys(s.services) : [];
                  let val = 0;
                  keys.forEach((k) => {
                    const c = s.services[k];
                    if (!c || c.suspended) return;
                    const st = serviceStatus(c);
                    if (st.code === 'expired' || st.code === 'none') return;
                    const group = k.split('|')[0];
                    const tier = (s.catalogue?.[group]?.tiers || []).find(
                      (t) => t.id === c.package
                    );
                    if (tier) val += tier.price;
                  });
                  const a = siteServiceAlert(s);
                  const soonest =
                    a && a.days != null
                      ? a.days < 0
                        ? 'Expired'
                        : `${a.days} days`
                      : '—';

                  return (
                    <tr key={s.id}>
                      <td>
                        <b>{s.name}</b>
                        <br />
                        <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>
                          {s.id}
                        </span>
                      </td>
                      <td className="mono">{keys.length}</td>
                      <td className="mono">₹{val.toLocaleString('en-IN')}</td>
                      <td className="mono">{soonest}</td>
                      <td>
                        {a ? (
                          <span className="status-pill">
                            <span
                              className="status-dot"
                              style={{ background: a.hex }}
                            ></span>
                            {a.label}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--ink-3)' }}>—</span>
                        )}
                      </td>
                      {canManage && (
                        <td>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => setManageSite(s)}
                          >
                            Manage
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {manageSite && (
        <ManageModal
          site={manageSite}
          onClose={() => setManageSite(null)}
          onRenew={renewContract}
        />
      )}
    </>
  );
}

/* ---------- Manage modal ---------- */
function ManageModal({ site, onClose, onRenew }) {
  const [renewKey, setRenewKey] = useState(null);
  const [chosenTier, setChosenTier] = useState(null);
  const [from, setFrom] = useState('expiry');
  const [busy, setBusy] = useState(false);

  const keys = site.services ? Object.keys(site.services) : [];

  const doRenew = async () => {
    if (!chosenTier) {
      toast.error('Pick a package');
      return;
    }
    setBusy(true);
    try {
      await onRenew({ siteId: site.id, key: renewKey, package: chosenTier, from });
      toast.success('Contract renewed.');
      setRenewKey(null);
      setChosenTier(null);
    } catch (e) {
      toast.error(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      width={620}
      title={`Manage — ${site.name}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          {renewKey ? (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setRenewKey(null);
                  setChosenTier(null);
                }}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={doRenew}
                disabled={busy || !chosenTier}
              >
                {busy ? 'Renewing…' : 'Confirm renewal'}
              </button>
            </>
          ) : null}
        </>
      }
    >
      {!renewKey ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {keys.length === 0 ? (
            <div className="empty">No contracts yet.</div>
          ) : (
            keys.map((k) => {
              const c = site.services[k];
              const L = serviceLabel(k);
              const st = serviceStatus(c);
              return (
                <div
                  key={k}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-md)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <b style={{ color: 'var(--ink)' }}>
                      {L.type}
                      {L.equip !== '—' ? ' · ' + L.equip : ''}
                    </b>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--ink-3)',
                        marginTop: 2,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {c.expiry ? `till ${fmtDay(c.expiry)}` : 'not set'}
                    </div>
                  </div>
                  <span className="status-pill">
                    <span className="status-dot" style={{ background: st.hex }}></span>
                    {st.label}
                  </span>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setRenewKey(k)}
                  >
                    ⟳ Renew
                  </button>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <RenewForm
          site={site}
          contractKey={renewKey}
          chosenTier={chosenTier}
          setChosenTier={setChosenTier}
          from={from}
          setFrom={setFrom}
        />
      )}
    </Modal>
  );
}

/* ---------- Renew form ---------- */
function RenewForm({ site, contractKey, chosenTier, setChosenTier, from, setFrom }) {
  const group = contractKey.split('|')[0];
  const L = serviceLabel(contractKey);
  const tiers = site.catalogue?.[group]?.tiers || [];
  const cur = site.services?.[contractKey];

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 14 }}>
        <b style={{ color: 'var(--ink)' }}>
          {L.type}
          {L.equip !== '—' ? ' · ' + L.equip : ''}
        </b>
        {cur && cur.expiry ? ` · valid till ${fmtDay(cur.expiry)}` : ''}
      </p>

      <div className="fg" style={{ marginBottom: 14 }}>
        <label>Select a package</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
          {tiers.map((t) => (
            <label
              key={t.id}
              className={'chk' + (chosenTier === t.id ? ' on' : '')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '12px 14px',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="radio"
                  name="pkg"
                  value={t.id}
                  checked={chosenTier === t.id}
                  onChange={() => setChosenTier(t.id)}
                  style={{ accentColor: 'var(--primary)' }}
                />
                <span>
                  <b>{t.label}</b>
                  <br />
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    {t.months} months
                  </span>
                </span>
              </span>
              <b style={{ fontFamily: 'var(--font-mono)' }}>
                ₹{t.price.toLocaleString('en-IN')}
              </b>
            </label>
          ))}
        </div>
      </div>

      <div className="fg">
        <label>Renewal starts from</label>
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="expiry">
            Continue from current expiry
            {cur && cur.expiry ? ` (${fmtDay(cur.expiry)})` : ''}
          </option>
          <option value="today">Start today</option>
        </select>
      </div>
    </div>
  );
}