import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { RANK, SIG_LABEL, HEX, PARAMS } from '../utils/cpcb';
import KPI from '../components/UI/KPI';
import Panel from '../components/UI/Panel';
import Sparkline from '../components/UI/Sparkline';
import StatusDoughnut from '../components/Charts/StatusDoughnut';
import ParamBar from '../components/Charts/ParamBar';
import SiteMap from '../components/SiteMap/SiteMap';
import Modal from '../components/UI/Modal';
import { fmtConfiguredDate } from '../utils/formatters';

const FILTERS = [
  ['all', 'All', null],
  ['green', 'Active Sites', '#059669'],
  ['yellow', 'Warning', '#d97706'],
  ['red', 'Exceedance', '#dc2626'],
  ['orange', 'Orange', '#ea580c'],
  ['purple', 'Critical', '#7c3aed'],
  ['grey', 'Offline', '#64748b'],
];

export default function Dashboard() {
  const { sites, alerts } = useData();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState('stations'); // 'stations' | 'grid'
  const [locModal, setLocModal] = useState(null);
  const navigate = useNavigate();

  const k = useMemo(() => computeKPIs(sites, alerts), [sites, alerts]);

  const filtered = useMemo(() => {
    return sites
      .filter((s) => {
        if (filter !== 'all' && s.signal !== filter) return false;
        if (query) {
          const q = query.toLowerCase();
          return (s.name + s.id + (s.sector || '') + (s.loc || '')).toLowerCase().includes(q);
        }
        return true;
      })
      .sort((a, b) => (RANK[b.signal] || 0) - (RANK[a.signal] || 0));
  }, [sites, filter, query]);

  const openSite = (site) => navigate('/sites/' + site.id);

  return (
    <>
      {/* Page header */}
      <div className="page-head">
        <div>
          <div className="page-title">Sites Information Dashboard</div>
          <div className="page-sub">
            <span className="live-dot"></span>
            Live · all connected sites · updated just now
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="kpis">
        <KPI color="g"  label="Active Sites"  value={k.green}  desc="Within limits"
          trend={[3, 4, 4, 5, 5, 5]} />
        <KPI color="y"  label="Warning"    value={k.yellow} desc="Attention required"
          trend={[0, 1, 0, 1, 2, 1]} />
        <KPI color="r"  label="Exceedance" value={k.red + k.orange + k.purple}
          desc="Non-compliant sites"
          trend={[1, 2, 2, 1, 1, 2]} />
        <KPI color="gr" label="Offline"    value={k.grey + k.delay}
          desc="No / delayed data"
          trend={[0, 0, 1, 0, 0, 1]} />
        <KPI color="b"  label="Total Sites" value={k.total} desc="Connected OCEMS"
          trend={[6, 7, 7, 8, 8, 8]} />
        <KPI color="o"  label="Alerts · 24h" value={k.alerts24}
          desc="Auto-generated"
          trend={[2, 5, 3, 6, 4, k.alerts24]} />
      </div>

      {/* Charts row */}
      <div className="two-col asym">
        <Panel title="Compliance Overview" hint="All sites · live status">
          <StatusDoughnut k={k} />
          <div
            className="legend-inline"
            style={{ marginTop: 16, justifyContent: 'center' }}
          >
            <span>
              <i className="ld" style={{ background: 'var(--st-green)' }}></i>Active Sites
            </span>
            <span>
              <i className="ld" style={{ background: 'var(--st-yellow)' }}></i>Warning
            </span>
            <span>
              <i className="ld" style={{ background: 'var(--st-red)' }}></i>Exceedance
            </span>
            <span>
              <i className="ld" style={{ background: 'var(--st-grey)' }}></i>Offline
            </span>
          </div>
        </Panel>

        <Panel title="Exceedances by Parameter" hint="Active flags this week">
          <ParamBar sites={sites} />
        </Panel>
      </div>

      {/* Map */}
      <Panel
        title="Site Locations"
        right={
          <div className="legend-inline">
            <span><i className="ld" style={{ background: 'var(--st-green)' }}></i>Active Sites</span>
            <span><i className="ld" style={{ background: 'var(--st-yellow)' }}></i>Warning</span>
            <span><i className="ld" style={{ background: 'var(--st-red)' }}></i>Exceedance</span>
            <span><i className="ld" style={{ background: 'var(--st-grey)' }}></i>Offline</span>
          </div>
        }
        body="none"
      >
        <SiteMap sites={sites} onSelect={openSite} height={460} />
      </Panel>

      {/* Stations & Sites Section */}
      <Panel
        title="Monitoring Stations & Devices"
        hint={`${filtered.length} stations shown`}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="view-toggle" style={{ display: 'flex' }}>
              <button
                type="button"
                className={`view-btn ${viewMode === 'stations' ? 'active' : ''}`}
                onClick={() => setViewMode('stations')}
                title="Stations List view (as shown in sample)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
                Stations
              </button>
              <button
                type="button"
                className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
                title="Compact Grid view"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
                Grid
              </button>
            </div>

            <div className="chips">
              {FILTERS.map(([f, l, col]) => (
                <button
                  key={f}
                  className={'chip' + (filter === f ? ' on' : '')}
                  onClick={() => setFilter(f)}
                >
                  {col ? (
                    <span className="cdot" style={{ background: col }}></span>
                  ) : null}
                  {l}
                </button>
              ))}
              <input
                className="search"
                placeholder="Search station, code, sector…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        }
      >
        {filtered.length === 0 ? (
          <div className="empty">No stations match this filter.</div>
        ) : viewMode === 'stations' ? (
          <div className="station-card-list">
            {filtered.map((s) => (
              <div
                key={s.id}
                className="station-card"
                onClick={() => openSite(s)}
                title="Click to view live station details"
              >
                <div className="station-col">
                  <span className="station-lbl">Device Type</span>
                  <span className="station-val station-type" title={s.deviceType || s.name}>
                    {s.deviceType || s.name}
                  </span>
                </div>

                <div className="station-col">
                  <span className="station-lbl">Device Id</span>
                  <span className="station-val mono">{s.id}</span>
                </div>

                <div className="station-col">
                  <span className="station-lbl">Device Configured Date</span>
                  <span className="station-val">
                    {fmtConfiguredDate(s.createdAt)}
                  </span>
                </div>

                <div className="station-col">
                  <span className="station-lbl">Total Parameters</span>
                  <span className="station-val">{s.params?.length || 0}</span>
                  <div className="station-dots">
                    {(s.params || []).map((p, i) => (
                      <span
                        key={p.pid || i}
                        className={`station-dot ${p.signal || 'green'}`}
                        title={`${p.name || p.key} [${p.pid || 'PID'}]: ${p.value} ${p.unit || ''} (${SIG_LABEL[p.signal] || p.signal})`}
                      />
                    ))}
                  </div>
                </div>

                <div className="station-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="station-btn-pin"
                    onClick={() => setLocModal(s)}
                    title={`View Location: ${s.loc || 'View on map'}`}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    className="station-btn-copy"
                    onClick={() => navigate('/addsite?duplicate=' + s.id)}
                    title={`Add another analyzer like this (${s.deviceType || s.name})`}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    className="station-btn-eye"
                    onClick={() => openSite(s)}
                    title="View Live Station Details"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" fill="currentColor" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid">
            {filtered.map((s) => (
              <SiteCard key={s.id} site={s} onClick={() => openSite(s)} />
            ))}
          </div>
        )}
      </Panel>

      {/* Station Location Modal */}
      {locModal && (
        <Modal
          open={true}
          title={`Station Location: ${locModal.deviceType || locModal.name}`}
          onClose={() => setLocModal(null)}
          width={520}
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setLocModal(null)}
              >
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setLocModal(null);
                  navigate('/map');
                }}
              >
                Open Full Interactive Map →
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'var(--primary-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--primary)',
                  fontSize: 22,
                }}
              >
                📍
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>
                  {locModal.deviceType || locModal.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  Device ID: <span className="mono" style={{ fontWeight: 600 }}>{locModal.id}</span> · {locModal.sector || 'Environmental Monitoring'}
                </div>
              </div>
            </div>

            <div
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 14,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 500 }}>Location / Address</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>
                  {locModal.loc || 'Not specified'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 500 }}>State Board (SPCB)</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>
                  {locModal.spcb || '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 500 }}>GPS Latitude</div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>
                  {locModal.lat ?? 28.6}° N
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 500 }}>GPS Longitude</div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>
                  {locModal.lng ?? 77.2}° E
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Configured on: <b>{fmtConfiguredDate(locModal.createdAt)}</b> with <b>{locModal.params?.length || 0} active parameters</b>.
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------------- helpers ---------------- */
function computeKPIs(sites, alerts) {
  const k = {
    total: sites.length,
    green: 0, yellow: 0, orange: 0, red: 0, purple: 0, grey: 0, delay: 0,
  };
  sites.forEach((s) => { k[s.signal] = (k[s.signal] || 0) + 1; });
  k.alerts24 = alerts.filter(
    (a) => Date.now() - new Date(a.time || a.ts).getTime() < 86400000
  ).length;
  return k;
}

/* ---------------- site card ---------------- */
function SiteCard({ site, onClick }) {
  const flagged = site.params.filter((p) =>
    ['yellow', 'orange', 'red', 'purple'].includes(p.signal)
  ).length;

  const topParams = site.params.slice(0, 3);

  return (
    <div className={'icard ' + site.signal} onClick={onClick}>
      <div className="icard-rail"></div>

      <div className="icard-head">
        <div className="icard-title">
          <div>
            <div className="icard-name">{site.name}</div>
            <div className="icard-meta">
              <span className="mono">{site.id}</span>
              <span className="sep">·</span>
              <span>{site.sector || '—'}</span>
            </div>
          </div>
          <span className="status-pill">
            <span className={'status-dot ' + site.signal}></span>
            {SIG_LABEL[site.signal]}
          </span>
        </div>
      </div>

      <div className="icard-body">
        {topParams.map((p, idx) => {
          const def = PARAMS[p.key] || {};
          const isFlagged = ['yellow', 'orange', 'red', 'purple'].includes(p.signal);
          const sparkData = p.history.slice(-12);
          return (
            <div className="param-row" key={p.pid || (p.key + '-' + idx)}>
              <span className="pname" title={p.key}>{p.name || p.key}</span>
              <span className="pspark">
                <Sparkline
                  data={sparkData}
                  width={56}
                  height={16}
                  color={HEX[p.signal] || HEX.green}
                />
              </span>
              <span className={'pval' + (isFlagged ? ' val-exc' : '')}>
                {p.value}
              </span>
              <span className="plimit">
                ≤{def.limit || p.limit}
                {def.unit ? ' ' + def.unit : ''}
              </span>
            </div>
          );
        })}
      </div>

      <div className="icard-foot">
        <span>
          {flagged > 0 ? (
            <span className="flag">⚠ {flagged} flagged</span>
          ) : (
            <span>All clear</span>
          )}
        </span>
        <span className="mono">{site.lastData || '—'}</span>
      </div>
    </div>
  );
}