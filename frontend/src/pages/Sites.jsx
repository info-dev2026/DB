import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { RANK, SIG_LABEL } from '../utils/cpcb';
import { fmtDay, timeAgo } from '../utils/formatters';
import Panel from '../components/UI/Panel';

export default function Sites() {
  const { sites } = useData();
  const { session } = useAuth();
  const navigate = useNavigate();

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [spcbFilter, setSpcbFilter] = useState('all');
  const [sortKey, setSortKey] = useState('creation_desc'); // Default to creation order (newest first)
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'grid'

  const canRegister = session?.role === 'admin' || session?.role === 'engineer';

  /* ------------------------------------------------------------
     1. Chronological Creation Sequence
     Index each site chronologically based on createdAt timestamp.
     Oldest site is #1, next is #2, up to latest #N.
     ------------------------------------------------------------ */
  const sitesWithMeta = useMemo(() => {
    // Sort ascending by creation to establish fixed chronological creation index
    const sortedChronological = sites.slice().sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ta - tb;
    });

    const rankMap = new Map();
    sortedChronological.forEach((s, idx) => {
      rankMap.set(s.id, idx + 1);
    });

    const now = Date.now();
    const thirtyDaysMs = 30 * 86400000;

    return sites.map((s) => {
      const cTime = s.createdAt ? new Date(s.createdAt).getTime() : null;
      return {
        ...s,
        creationRank: rankMap.get(s.id) || 1,
        isNew: cTime ? now - cTime < thirtyDaysMs : false,
      };
    });
  }, [sites]);

  /* ------------------------------------------------------------
     2. Distinct Sectors & SPCBs for Filter Dropdowns
     ------------------------------------------------------------ */
  const { sectors, spcbs } = useMemo(() => {
    const secSet = new Set();
    const spcbSet = new Set();
    sites.forEach((s) => {
      if (s.sector && s.sector !== '—') secSet.add(s.sector);
      if (s.spcb && s.spcb !== '—') spcbSet.add(s.spcb);
    });
    return {
      sectors: Array.from(secSet).sort(),
      spcbs: Array.from(spcbSet).sort(),
    };
  }, [sites]);

  /* ------------------------------------------------------------
     3. KPI Compliance Counts (for summary and interactive filter)
     ------------------------------------------------------------ */
  const counts = useMemo(() => {
    const c = { total: sites.length, green: 0, yellow: 0, exceed: 0, offline: 0 };
    sites.forEach((s) => {
      if (s.signal === 'green') c.green++;
      else if (s.signal === 'yellow') c.yellow++;
      else if (['red', 'orange', 'purple'].includes(s.signal)) c.exceed++;
      else c.offline++;
    });
    return c;
  }, [sites]);

  /* ------------------------------------------------------------
     4. Filter & Sort Pipeline
     ------------------------------------------------------------ */
  const filteredAndSortedList = useMemo(() => {
    let result = sitesWithMeta.slice();

    // Text search (Site name, code, sector, location, SPCB, contact)
    if (q.trim()) {
      const ql = q.trim().toLowerCase();
      result = result.filter(
        (s) =>
          (s.name || '').toLowerCase().includes(ql) ||
          (s.id || '').toLowerCase().includes(ql) ||
          (s.sector || '').toLowerCase().includes(ql) ||
          (s.loc || '').toLowerCase().includes(ql) ||
          (s.spcb || '').toLowerCase().includes(ql) ||
          (s.contact || '').toLowerCase().includes(ql)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'green') {
        result = result.filter((s) => s.signal === 'green');
      } else if (statusFilter === 'yellow') {
        result = result.filter((s) => s.signal === 'yellow');
      } else if (statusFilter === 'exceed') {
        result = result.filter((s) => ['red', 'orange', 'purple'].includes(s.signal));
      } else if (statusFilter === 'offline') {
        result = result.filter((s) => !['green', 'yellow', 'red', 'orange', 'purple'].includes(s.signal));
      }
    }

    // Sector filter
    if (sectorFilter !== 'all') {
      result = result.filter((s) => s.sector === sectorFilter);
    }

    // SPCB filter
    if (spcbFilter !== 'all') {
      result = result.filter((s) => s.spcb === spcbFilter);
    }

    // Sorting
    result.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;

      switch (sortKey) {
        case 'creation_desc':
          // Newest created first (Creation Order: Latest to First)
          return timeB - timeA || b.creationRank - a.creationRank;
        case 'creation_asc':
          // Oldest created first (Creation Order: First to Latest #1..#N)
          return timeA - timeB || a.creationRank - b.creationRank;
        case 'name_asc':
          return (a.name || '').localeCompare(b.name || '');
        case 'name_desc':
          return (b.name || '').localeCompare(a.name || '');
        case 'id_asc':
          return (a.id || '').localeCompare(b.id || '');
        case 'id_desc':
          return (b.id || '').localeCompare(a.id || '');
        case 'sector_asc':
          return (a.sector || '').localeCompare(b.sector || '');
        case 'sector_desc':
          return (b.sector || '').localeCompare(a.sector || '');
        case 'status_desc':
          return (RANK[b.signal] || 0) - (RANK[a.signal] || 0);
        case 'status_asc':
          return (RANK[a.signal] || 0) - (RANK[b.signal] || 0);
        case 'params_desc':
          return (b.params?.length || 0) - (a.params?.length || 0);
        default:
          return timeB - timeA;
      }
    });

    return result;
  }, [sitesWithMeta, q, statusFilter, sectorFilter, spcbFilter, sortKey]);

  /* ------------------------------------------------------------
     5. Sort Direction & Header Toggles
     ------------------------------------------------------------ */
  const toggleSort = (field) => {
    if (field === 'creation') {
      setSortKey((prev) => (prev === 'creation_desc' ? 'creation_asc' : 'creation_desc'));
    } else if (field === 'name') {
      setSortKey((prev) => (prev === 'name_asc' ? 'name_desc' : 'name_asc'));
    } else if (field === 'id') {
      setSortKey((prev) => (prev === 'id_asc' ? 'id_desc' : 'id_asc'));
    } else if (field === 'sector') {
      setSortKey((prev) => (prev === 'sector_asc' ? 'sector_desc' : 'sector_asc'));
    } else if (field === 'status') {
      setSortKey((prev) => (prev === 'status_desc' ? 'status_asc' : 'status_desc'));
    }
  };

  const isCreationSorted = sortKey === 'creation_desc' || sortKey === 'creation_asc';

  /* ------------------------------------------------------------
     6. CSV Export Function
     ------------------------------------------------------------ */
  const handleExportCSV = () => {
    const headers = [
      'Creation Rank',
      'Site Code',
      'Industry Name',
      'Sector',
      'SPCB',
      'Location',
      'Category',
      'Ganga Basin',
      'Monitored Parameters',
      'Compliance Status',
      'Created Date',
      'Last Transmission',
    ];

    const rows = filteredAndSortedList.map((s) => [
      `#${String(s.creationRank).padStart(2, '0')}`,
      s.id,
      `"${(s.name || '').replace(/"/g, '""')}"`,
      `"${(s.sector || '').replace(/"/g, '""')}"`,
      s.spcb || '',
      `"${(s.loc || '').replace(/"/g, '""')}"`,
      s.category || '',
      s.ganga ? 'Yes' : 'No',
      s.params?.length || 0,
      SIG_LABEL[s.signal] || s.signal || '',
      s.createdAt ? fmtDay(s.createdAt) : '',
      s.lastData || '',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `saaphzone_industries_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /* ------------------------------------------------------------
     7. Filter Reset
     ------------------------------------------------------------ */
  const resetFilters = () => {
    setQ('');
    setStatusFilter('all');
    setSectorFilter('all');
    setSpcbFilter('all');
    setSortKey('creation_desc');
  };

  const hasActiveFilters =
    q.trim() !== '' ||
    statusFilter !== 'all' ||
    sectorFilter !== 'all' ||
    spcbFilter !== 'all';

  return (
    <>
      {/* Page Header */}
      <div className="page-head">
        <div>
          <div className="page-title">Industrial Sites Directory</div>
          <div className="page-sub">
            <span>{counts.total} registered industries</span>
            <span>·</span>
            <span style={{ color: 'var(--st-green)', fontWeight: 500 }}>
              {counts.green} active sites
            </span>
            <span>·</span>
            <span style={{ color: counts.exceed > 0 ? 'var(--st-red)' : 'inherit' }}>
              {counts.exceed} non-compliant
            </span>
            <span>·</span>
            <span style={{ color: 'var(--primary)' }}>
              Ordered according to creation date
            </span>
          </div>
        </div>

        <div className="sites-header-actions">
          {canRegister && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate('/addsite?action=new')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Register New Site
            </button>
          )}

          <button
            className="btn btn-ghost btn-sm"
            onClick={handleExportCSV}
            title="Download CSV report of current view"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI Ribbon with interactive filter toggles */}
      <div className="kpis">
        <div
          className={`kpi b kpi-clickable ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStatusFilter('all')}
          title="Click to show all industries"
        >
          <div className="kpi-rail"></div>
          <div className="kpi-label">Total Registered</div>
          <div className="kpi-value-row">
            <div className="kpi-value">{counts.total}</div>
          </div>
          <div className="kpi-desc">
            <span className="dot" style={{ background: 'var(--accent)' }}></span>
            <span>All onboarded industries</span>
          </div>
        </div>

        <div
          className={`kpi g kpi-clickable ${statusFilter === 'green' ? 'active' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'green' ? 'all' : 'green')}
          title="Click to filter active sites"
        >
          <div className="kpi-rail"></div>
          <div className="kpi-label">Active Sites</div>
          <div className="kpi-value-row">
            <div className="kpi-value">{counts.green}</div>
          </div>
          <div className="kpi-desc">
            <span className="dot" style={{ background: 'var(--st-green)' }}></span>
            <span>Within CPCB norms</span>
          </div>
        </div>

        <div
          className={`kpi y kpi-clickable ${statusFilter === 'yellow' ? 'active' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'yellow' ? 'all' : 'yellow')}
          title="Click to filter warning industries"
        >
          <div className="kpi-rail"></div>
          <div className="kpi-label">Observation</div>
          <div className="kpi-value-row">
            <div className="kpi-value">{counts.yellow}</div>
          </div>
          <div className="kpi-desc">
            <span className="dot" style={{ background: 'var(--st-yellow)' }}></span>
            <span>Near standard threshold</span>
          </div>
        </div>

        <div
          className={`kpi r kpi-clickable ${statusFilter === 'exceed' ? 'active' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'exceed' ? 'all' : 'exceed')}
          title="Click to filter non-compliant industries"
        >
          <div className="kpi-rail"></div>
          <div className="kpi-label">Non-Compliant</div>
          <div className="kpi-value-row">
            <div className="kpi-value">{counts.exceed}</div>
          </div>
          <div className="kpi-desc">
            <span className="dot" style={{ background: 'var(--st-red)' }}></span>
            <span>Critical exceedance</span>
          </div>
        </div>

        <div
          className={`kpi gr kpi-clickable ${statusFilter === 'offline' ? 'active' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'offline' ? 'all' : 'offline')}
          title="Click to filter offline / delayed sites"
        >
          <div className="kpi-rail"></div>
          <div className="kpi-label">Offline / Delayed</div>
          <div className="kpi-value-row">
            <div className="kpi-value">{counts.offline}</div>
          </div>
          <div className="kpi-desc">
            <span className="dot" style={{ background: 'var(--st-grey)' }}></span>
            <span>Data transmission lapse</span>
          </div>
        </div>
      </div>

      {/* Main Panel with Filter & Control Bar */}
      <Panel
        title="Industries Registry"
        hint={`${filteredAndSortedList.length} of ${sites.length} industries shown`}
        right={
          <div className="view-toggle">
            <button
              className={`view-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
              title="Table view"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
              Table
            </button>
            <button
              className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid cards view"
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
        }
        body="flush"
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-2)' }}>
          <div className="sites-control-row">
            <div className="sites-filters-wrap">
              {/* Search Bar */}
              <input
                className="search"
                placeholder="Search by site name, code, sector, location…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ minWidth: 260 }}
              />

              {/* Sector Dropdown */}
              <select
                className="sites-select"
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
              >
                <option value="all">All Sectors ({sectors.length})</option>
                {sectors.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </select>

              {/* SPCB Dropdown */}
              <select
                className="sites-select"
                value={spcbFilter}
                onChange={(e) => setSpcbFilter(e.target.value)}
              >
                <option value="all">All SPCBs ({spcbs.length})</option>
                {spcbs.map((sp) => (
                  <option key={sp} value={sp}>
                    {sp}
                  </option>
                ))}
              </select>

              {/* Compliance Status Dropdown */}
              <select
                className="sites-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Statuses</option>
                <option value="green">Active Sites (Compliant)</option>
                <option value="yellow">Warning (Yellow)</option>
                <option value="exceed">Non-Compliant (Exceedance)</option>
                <option value="offline">Offline / Delay</option>
              </select>
            </div>

            {/* Systematic Sort Selector with Creation Order as primary */}
            <div className="sites-sort-control">
              <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>
                Sort:
              </span>
              <select
                className="sites-select"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                style={{ fontWeight: isCreationSorted ? 600 : 400 }}
              >
                <option value="creation_desc">Created: Newest First (Latest)</option>
                <option value="creation_asc">Created: Oldest First (#1 → #N)</option>
                <option value="name_asc">Industry Name (A → Z)</option>
                <option value="name_desc">Industry Name (Z → A)</option>
                <option value="id_asc">Site Code (A → Z)</option>
                <option value="status_desc">Compliance Severity</option>
                <option value="params_desc">Monitored Params Count</option>
              </select>

              {/* 1-click sort direction switcher */}
              <button
                className="sort-dir-btn"
                title={
                  sortKey.endsWith('_desc')
                    ? 'Descending (click to switch to Ascending)'
                    : 'Ascending (click to switch to Descending)'
                }
                onClick={() => {
                  if (sortKey === 'creation_desc') setSortKey('creation_asc');
                  else if (sortKey === 'creation_asc') setSortKey('creation_desc');
                  else if (sortKey.endsWith('_desc')) setSortKey(sortKey.replace('_desc', '_asc'));
                  else if (sortKey.endsWith('_asc')) setSortKey(sortKey.replace('_asc', '_desc'));
                }}
              >
                {sortKey.endsWith('_desc') ? '↓' : '↑'}
              </button>
            </div>
          </div>
        </div>

        {/* Active Filters & Summary Bar */}
        {hasActiveFilters && (
          <div className="active-filters-bar">
            <div className="active-filter-tags">
              <span>Active filters:</span>

              {q.trim() && (
                <span className="active-tag">
                  Keyword: “{q}”
                  <button onClick={() => setQ('')}>✕</button>
                </span>
              )}

              {statusFilter !== 'all' && (
                <span className="active-tag">
                  Status: {statusFilter}
                  <button onClick={() => setStatusFilter('all')}>✕</button>
                </span>
              )}

              {sectorFilter !== 'all' && (
                <span className="active-tag">
                  Sector: {sectorFilter}
                  <button onClick={() => setSectorFilter('all')}>✕</button>
                </span>
              )}

              {spcbFilter !== 'all' && (
                <span className="active-tag">
                  SPCB: {spcbFilter}
                  <button onClick={() => setSpcbFilter('all')}>✕</button>
                </span>
              )}
            </div>

            <button className="reset-all-btn" onClick={resetFilters}>
              Reset all filters
            </button>
          </div>
        )}

        {/* View Mode: Table */}
        {viewMode === 'table' ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th
                    style={{ width: '56px', textAlign: 'center' }}
                    className={`col-sortable ${isCreationSorted ? 'active' : ''}`}
                    onClick={() => toggleSort('creation')}
                    title="Click to sort by creation sequence"
                  >
                    #
                    {isCreationSorted && (
                      <span className="sort-icon">
                        {sortKey === 'creation_asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </th>
                  <th
                    style={{ width: '28%' }}
                    className={`col-sortable ${sortKey.startsWith('name') ? 'active' : ''}`}
                    onClick={() => toggleSort('name')}
                  >
                    Industry & Location
                    {sortKey.startsWith('name') && (
                      <span className="sort-icon">
                        {sortKey === 'name_asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </th>
                  <th
                    className={`col-sortable ${sortKey.startsWith('id') ? 'active' : ''}`}
                    onClick={() => toggleSort('id')}
                  >
                    Site Code
                    {sortKey.startsWith('id') && (
                      <span className="sort-icon">
                        {sortKey === 'id_asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </th>
                  <th
                    className={`col-sortable ${sortKey.startsWith('sector') ? 'active' : ''}`}
                    onClick={() => toggleSort('sector')}
                  >
                    Sector
                    {sortKey.startsWith('sector') && (
                      <span className="sort-icon">
                        {sortKey === 'sector_asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </th>
                  <th>SPCB</th>
                  <th>Params</th>
                  <th
                    className={`col-sortable ${sortKey.startsWith('status') ? 'active' : ''}`}
                    onClick={() => toggleSort('status')}
                  >
                    Compliance Status
                    {sortKey.startsWith('status') && (
                      <span className="sort-icon">
                        {sortKey === 'status_asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </th>
                  <th
                    className={`col-sortable ${isCreationSorted ? 'active' : ''}`}
                    onClick={() => toggleSort('creation')}
                    style={{ minWidth: 130 }}
                  >
                    Created On
                    {isCreationSorted && (
                      <span className="sort-icon">
                        {sortKey === 'creation_asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </th>
                  <th>Last Update</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedList.length === 0 ? (
                  <tr>
                    <td colSpan="10">
                      <div className="empty" style={{ padding: '60px 20px' }}>
                        <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
                        <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
                          No industries match your criteria
                        </div>
                        <div style={{ color: 'var(--ink-3)', marginTop: 4, fontSize: 12 }}>
                          Try clearing your search query or relaxing active filters.
                        </div>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ marginTop: 14 }}
                          onClick={resetFilters}
                        >
                          Clear Filters
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredAndSortedList.map((s) => (
                    <tr
                      key={s.id}
                      className="rowlink"
                      onClick={() => navigate('/sites/' + s.id)}
                    >
                      {/* Creation Sequence Rank Badge */}
                      <td style={{ textAlign: 'center' }}>
                        <span
                          className="creation-rank-badge"
                          title={`Creation Order: Industry #${s.creationRank}`}
                        >
                          #{String(s.creationRank).padStart(2, '0')}
                        </span>
                      </td>

                      {/* Industry Name & Location */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <b>{s.name}</b>
                          {s.isNew && <span className="new-badge">NEW</span>}
                        </div>
                        <div style={{ color: 'var(--ink-3)', fontSize: 11, marginTop: 2 }}>
                          📍 {s.loc || '—'}
                          {s.ganga && (
                            <span
                              style={{
                                marginLeft: 8,
                                color: 'var(--accent)',
                                fontWeight: 500,
                              }}
                            >
                              • GPI Ganga
                            </span>
                          )}
                          {s.category && (
                            <span style={{ marginLeft: 6, color: 'var(--ink-4)' }}>
                              • {s.category}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Site Code */}
                      <td>
                        <span className="mono" style={{ fontWeight: 600 }}>
                          {s.id}
                        </span>
                      </td>

                      {/* Sector */}
                      <td>
                        <span className="sector-tag">{s.sector || '—'}</span>
                      </td>

                      {/* SPCB */}
                      <td>
                        <span className="spcb-tag">{s.spcb || '—'}</span>
                      </td>

                      {/* Parameters Count & Preview Dots */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="mono" style={{ fontWeight: 500 }}>
                            {s.params?.length || 0} params
                          </span>
                          <div className="param-preview-dots">
                            {(s.params || []).slice(0, 6).map((p, i) => (
                              <span
                                key={i}
                                className={`param-preview-dot ${p.signal || 'green'}`}
                                title={`${p.key}: ${p.value} ${p.unit} (${p.signal})`}
                              />
                            ))}
                          </div>
                        </div>
                      </td>

                      {/* Compliance Status */}
                      <td>
                        <span className="status-pill">
                          <span className={'status-dot ' + s.signal}></span>
                          {SIG_LABEL[s.signal] || s.signal}
                        </span>
                      </td>

                      {/* Created On Date & Time Ago */}
                      <td>
                        <div className="creation-date-cell">
                          <span className="creation-date-main">
                            📅 {s.createdAt ? fmtDay(s.createdAt) : '—'}
                          </span>
                          {s.createdAt && (
                            <span className="creation-date-sub">
                              {timeAgo(s.createdAt)}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Last Update */}
                      <td className="mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}>
                        {s.lastData || '—'}
                      </td>

                      {/* Action */}
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate('/sites/' + s.id);
                          }}
                        >
                          View →
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* View Mode: Grid Cards */
          <div style={{ padding: 20 }}>
            {filteredAndSortedList.length === 0 ? (
              <div className="empty">
                No industries match your search or filter criteria.
              </div>
            ) : (
              <div className="grid">
                {filteredAndSortedList.map((s) => (
                  <div
                    key={s.id}
                    className="grid-site-card"
                    onClick={() => navigate('/sites/' + s.id)}
                  >
                    <div className={`grid-site-rail status-dot ${s.signal}`} />

                    <div className="grid-card-head">
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="creation-rank-badge">
                            #{String(s.creationRank).padStart(2, '0')}
                          </span>
                          <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                            {s.id}
                          </span>
                          {s.isNew && <span className="new-badge">NEW</span>}
                        </div>
                        <div className="grid-card-title" style={{ marginTop: 6 }}>
                          {s.name}
                        </div>
                      </div>

                      <span className="status-pill">
                        <span className={'status-dot ' + s.signal}></span>
                        {SIG_LABEL[s.signal] || s.signal}
                      </span>
                    </div>

                    <div className="grid-card-meta">
                      <span className="sector-tag">{s.sector || '—'}</span>
                      <span className="spcb-tag">{s.spcb || '—'}</span>
                      <span>📍 {s.loc || '—'}</span>
                    </div>

                    {/* Monitored Parameters Grid */}
                    {s.params && s.params.length > 0 && (
                      <div className="grid-card-params">
                        {s.params.slice(0, 6).map((p, i) => (
                          <div key={i} className="grid-param-item">
                            <span className="grid-param-name">{p.key}</span>
                            <span
                              className="grid-param-val"
                              style={{
                                color:
                                  p.signal === 'green'
                                    ? 'var(--ink)'
                                    : p.signal === 'yellow'
                                    ? 'var(--st-yellow)'
                                    : 'var(--st-red)',
                              }}
                            >
                              {p.value} <span style={{ fontSize: 9, fontWeight: 400 }}>{p.unit}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="grid-card-foot">
                      <div>
                        📅 Created: {s.createdAt ? fmtDay(s.createdAt) : '—'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>Updated: {s.lastData || '—'}</span>
                        <span style={{ color: 'var(--primary)', fontWeight: 600 }}>
                          View →
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Panel Footer Summary */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px',
            borderTop: '1px solid var(--border-2)',
            fontSize: 12,
            color: 'var(--ink-3)',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            Showing <b>{filteredAndSortedList.length}</b> of <b>{sites.length}</b> industries
            {isCreationSorted && (
              <span style={{ marginLeft: 6 }}>
                · Ordered by <b>Creation Date ({sortKey === 'creation_desc' ? 'Newest first' : 'Oldest first'})</b>
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <span>
              Active Sites: <b>{counts.green}</b>
            </span>
            <span>
              Warning: <b>{counts.yellow}</b>
            </span>
            <span style={{ color: counts.exceed > 0 ? 'var(--st-red)' : 'inherit' }}>
              Exceedance: <b>{counts.exceed}</b>
            </span>
            <span>
              Offline: <b>{counts.offline}</b>
            </span>
          </div>
        </div>
      </Panel>
    </>
  );
}