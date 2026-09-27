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

const FILTERS = [
  ['all', 'All', null],
  ['green', 'Compliant', '#059669'],
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
        <KPI color="g"  label="Compliant"  value={k.green}  desc="Within limits"
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
              <i className="ld" style={{ background: 'var(--st-green)' }}></i>Compliant
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
            <span><i className="ld" style={{ background: 'var(--st-green)' }}></i>Compliant</span>
            <span><i className="ld" style={{ background: 'var(--st-yellow)' }}></i>Warning</span>
            <span><i className="ld" style={{ background: 'var(--st-red)' }}></i>Exceedance</span>
            <span><i className="ld" style={{ background: 'var(--st-grey)' }}></i>Offline</span>
          </div>
        }
        body="none"
      >
        <SiteMap sites={sites} onSelect={openSite} height={460} />
      </Panel>

      {/* Site cards */}
      <Panel
        title="All Sites"
        right={
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
              placeholder="Search site, code, sector…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <div className="empty">No sites match this filter.</div>
        ) : (
          <div className="grid">
            {filtered.map((s) => (
              <SiteCard key={s.id} site={s} onClick={() => openSite(s)} />
            ))}
          </div>
        )}
      </Panel>
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
        {topParams.map((p) => {
          const def = PARAMS[p.key] || {};
          const isFlagged = ['yellow', 'orange', 'red', 'purple'].includes(p.signal);
          const sparkData = p.history.slice(-12);
          return (
            <div className="param-row" key={p.key}>
              <span className="pname">{p.key}</span>
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