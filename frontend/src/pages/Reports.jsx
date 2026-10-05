import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { api as realApi } from '../api/api';
import { mockApi } from '../api/mockApi';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { fmtDay } from '../utils/formatters';
import { PARAMS } from '../utils/cpcb';
import Panel from '../components/UI/Panel';
import Modal from '../components/UI/Modal';

export default function Reports() {
  const { session } = useAuth();
  const { sites } = useData();

  const availableSites =
    session?.role === 'industry'
      ? sites.filter((s) => s.id === session.siteId)
      : sites;

  const [siteId, setSiteId] = useState(availableSites[0]?.id || '');
  const site = sites.find((s) => s.id === siteId);
  const [period, setPeriod] = useState('daily');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  // Site search state
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all'); // 'all' | 'live' | 'flagged' | 'ganga'

  const filteredSites = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return availableSites.filter((s) => {
      if (filterCategory === 'live' && s.signal !== 'green') return false;
      if (filterCategory === 'flagged' && !['yellow', 'orange', 'red', 'purple'].includes(s.signal)) return false;
      if (filterCategory === 'ganga' && !s.ganga) return false;
      if (!q) return true;
      return (
        s.name?.toLowerCase().includes(q) ||
        s.id?.toLowerCase().includes(q) ||
        s.sector?.toLowerCase().includes(q) ||
        s.loc?.toLowerCase().includes(q) ||
        s.spcb?.toLowerCase().includes(q) ||
        s.deviceType?.toLowerCase().includes(q) ||
        s.contact?.toLowerCase().includes(q) ||
        (s.params || []).some((p) =>
          p.key?.toLowerCase().includes(q) ||
          p.name?.toLowerCase().includes(q) ||
          p.pid?.toLowerCase().includes(q)
        )
      );
    });
  }, [availableSites, searchQuery, filterCategory]);

  const computeRange = () => {
    const now = Date.now();
    const day = 86400000;
    if (period === 'custom') {
      if (!fromDate || !toDate) {
        toast.error('Pick both dates.');
        return null;
      }
      return {
        from: new Date(fromDate).getTime(),
        to: new Date(toDate).getTime() + day,
      };
    }
    if (period === 'daily') return { from: now - day, to: now };
    if (period === 'monthly') return { from: now - 30 * day, to: now };
    if (period === 'quarterly') return { from: now - 90 * day, to: now };
    return { from: now - 7 * day, to: now };
  };

  const fetchRows = async () => {
    const range = computeRange();
    if (!range) return null;

    // Convert millisecond timestamps to ISO strings for the API
    const fromIso = new Date(range.from).toISOString();
    const toIso = new Date(range.to).toISOString();

    let response;
    try {
      response = await realApi.getReportData({
        siteId,
        from: fromIso,
        to: toIso,
      });
    } catch {
      response = await mockApi.getReportData({
        siteId,
        from: range.from,
        to: range.to,
      });
    }

    // Backend returns { siteId, from, to, count, rows: [{ pid, param, value, ts }] }
    // Or mockApi returns { readings: [{ siteId, param, value, ts }] }
    const readings = (response?.rows || response?.readings || []).map((r) => ({
      ts: new Date(r.ts).getTime(),
      param: r.param,
      value: Number(r.value),
    }));

    return { readings, range };
  };

  const generate = async (fmt) => {
    setBusy(true);
    try {
      const data = await fetchRows();
      if (!data || !data.readings.length) {
        toast.error('No data for this range.');
        return;
      }
      const filename = `${siteId}_${period}_OCEMS.${fmt === 'pdf' ? 'pdf' : 'xlsx'}`;

      const grouped = {};
      data.readings.forEach((r) => {
        const k = r.ts;
        const pKey = r.param === 'SO2' ? 'SOX' : r.param;
        grouped[k] = grouped[k] || { ts: r.ts };
        grouped[k][pKey] = r.value;
      });
      const rows = Object.values(grouped).sort((a, b) => a.ts - b.ts);
      const paramKeys =
        site?.params.map((p) => (p.key === 'SO2' ? 'SOX' : p.key)) ||
        [...new Set(data.readings.map((r) => (r.param === 'SO2' ? 'SOX' : r.param)))];

      const getParamLabel = (k) => {
        const found = (site?.params || []).find((p) => p.key === k);
        return found?.name || k;
      };

      if (fmt === 'xls') {
        if (!window.XLSX) {
          toast.error('Excel library not loaded.');
          return;
        }
        const sheetRows = rows.map((r) => {
          const o = {
            Timestamp: new Date(r.ts).toLocaleString('en-IN', { hour12: false }),
          };
          paramKeys.forEach((k) => {
            o[getParamLabel(k)] = r[k];
          });
          return o;
        });
        const ws = window.XLSX.utils.json_to_sheet(sheetRows);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'OCEMS Data');
        window.XLSX.writeFile(wb, filename);
        toast.success('Excel report downloaded.');
        return;
      }

      if (fmt === 'pdf') {
        if (!window.jspdf) {
          toast.error('PDF library not loaded.');
          return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape' });
        doc.setFontSize(16);
        doc.setTextColor(15, 118, 110);
        doc.text('Saaphzone OCEMS — Data Report', 14, 16);
        doc.setFontSize(10);
        doc.setTextColor(107, 122, 125);
        doc.text(`${site?.name || siteId} (${siteId}) · ${period}`, 14, 23);
        doc.text(
          `Generated ${new Date().toLocaleString('en-IN')}`,
          14,
          29
        );

        const head = [['Timestamp', ...paramKeys.map((k) => getParamLabel(k))]];
        const body = rows.map((r) => [
          new Date(r.ts).toLocaleString('en-IN'),
          ...paramKeys.map((k) => r[k] ?? '—'),
        ]);

        if (typeof doc.autoTable === 'function') {
          doc.autoTable({
            startY: 34,
            head,
            body,
            styles: { fontSize: 7, cellPadding: 1.5 },
            headStyles: { fillColor: [15, 118, 110] },
            alternateRowStyles: { fillColor: [249, 251, 251] },
            margin: { left: 14, right: 14 },
          });
        }
        doc.save(filename);
        toast.success('PDF report downloaded.');
      }
    } catch (e) {
      toast.error(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const doPreview = async () => {
    setBusy(true);
    try {
      const data = await fetchRows();
      if (!data) return;
      const grouped = {};
      data.readings.forEach((r) => {
        const k = r.ts;
        const pKey = r.param === 'SO2' ? 'SOX' : r.param;
        grouped[k] = grouped[k] || { ts: r.ts };
        grouped[k][pKey] = r.value;
      });
      setPreview({
        siteId,
        range: data.range,
        rows: Object.values(grouped)
          .sort((a, b) => a.ts - b.ts)
          .slice(0, 80),
        params: site?.params?.length
          ? site.params.map((p) => p.key)
          : Object.keys(PARAMS),
      });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-sub">
            <span>Generate & download data · PDF or Excel</span>
          </div>
        </div>
      </div>

      <Panel
        title="Generate Data Report"
        hint="Select site and period"
        right={
          availableSites.length > 1 ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowSearchModal(true)}
              title="Search and select site by name, code, sector or city"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <span>🔍</span>
              <span>Search Site</span>
            </button>
          ) : null
        }
      >
        <div className="form-grid">
          <div className="fg">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label style={{ margin: 0 }}>Site</label>
              {availableSites.length > 1 && (
                <button
                  type="button"
                  onClick={() => setShowSearchModal(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--primary)',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  title="Search site by name, code, sector or city"
                >
                  <span>🔍</span> Search Site
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={siteId}
                onChange={(e) => {
                  setSiteId(e.target.value);
                  setPreview(null);
                }}
                style={{ flex: 1 }}
              >
                {availableSites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id})
                  </option>
                ))}
              </select>
              {availableSites.length > 1 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowSearchModal(true)}
                  title="Search site by name, code, sector or city"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 38, padding: '0 12px', whiteSpace: 'nowrap' }}
                >
                  <span>🔍</span>
                  <span>Search</span>
                </button>
              )}
            </div>

            {site && (
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="status-pill" style={{ fontSize: 9.5, padding: '1px 5px', height: 16 }}>
                  <span className={'status-dot ' + site.signal}></span>
                  {site.signal}
                </span>
                <span className="mono" style={{ fontWeight: 600, color: 'var(--ink)' }}>{site.id}</span>
                <span>·</span>
                <span>{site.sector || 'Industrial'}</span>
                <span>·</span>
                <span>{site.loc || '—'}</span>
                {site.spcb && <><span>·</span><span>SPCB: {site.spcb}</span></>}
              </div>
            )}
          </div>

          <div className="fg">
            <label>Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="daily">Daily (last 24 h)</option>
              <option value="monthly">Monthly (30 d)</option>
              <option value="quarterly">Quarterly (90 d)</option>
              <option value="custom">Custom range</option>
            </select>
          </div>

          {period === 'custom' && (
            <>
              <div className="fg">
                <label>From</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              </div>
              <div className="fg">
                <label>To</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 22,
            paddingTop: 18,
            borderTop: '1px solid var(--border-2)',
            flexWrap: 'wrap',
          }}
        >
          <button
            className="btn btn-primary"
            onClick={() => generate('pdf')}
            disabled={busy}
          >
            ⬇ Download PDF
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => generate('xls')}
            disabled={busy}
          >
            ⬇ Download Excel
          </button>
          <button
            className="btn btn-ghost"
            onClick={doPreview}
            disabled={busy}
          >
            👁 Preview data
          </button>
        </div>
      </Panel>

      {preview && (
        <Panel
          title="Preview"
          hint={`${preview.rows.length} rows · ${fmtDay(preview.range.from)} → ${fmtDay(
            preview.range.to
          )}`}
          body="flush"
        >
          <div style={{ overflow: 'auto', maxHeight: 420 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Time</th>
                  {preview.params.map((k) => {
                    const found = (site?.params || []).find((p) => p.key === k);
                    return <th key={k}>{found?.name || k}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="mono">
                      {new Date(r.ts).toLocaleString('en-IN', { hour12: false })}
                    </td>
                    {preview.params.map((k) => {
                      const v = r[k];
                      const def = PARAMS[k];
                      const exc =
                        def && !def.ph && typeof v === 'number' && v > def.limit;
                      const isNA = v == null || v === '' || v === 'NA' || (typeof v === 'number' && isNaN(v));
                      return (
                        <td
                          key={k}
                          className={'mono ' + (exc ? 'val-exc' : (isNA ? 'val-na' : ''))}
                        >
                          {isNA ? 'NA' : v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Search Site Modal */}
      <Modal
        open={showSearchModal}
        title="Search & Select Site"
        onClose={() => setShowSearchModal(false)}
        width={620}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              Showing {filteredSites.length} of {availableSites.length} available sites
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowSearchModal(false)}
            >
              Close
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Search Input */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              className="input"
              placeholder="Search by site name, code (e.g. ESK-4417), city, sector, or parameter..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                paddingLeft: 34,
                paddingRight: searchQuery ? 32 : 12,
                height: 38,
                fontSize: 13,
              }}
            />
            <span
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 14,
                color: 'var(--ink-3)',
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  color: 'var(--ink-3)',
                  padding: 4,
                }}
                title="Clear search query"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick Filter Chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${filterCategory === 'all' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '2px 8px', height: 24 }}
              onClick={() => setFilterCategory('all')}
            >
              All ({availableSites.length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filterCategory === 'live' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '2px 8px', height: 24 }}
              onClick={() => setFilterCategory('live')}
            >
              <span className="status-dot green" style={{ width: 6, height: 6, display: 'inline-block', marginRight: 4 }}></span>
              Live ({availableSites.filter((s) => s.signal === 'green').length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filterCategory === 'flagged' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '2px 8px', height: 24 }}
              onClick={() => setFilterCategory('flagged')}
            >
              <span className="status-dot yellow" style={{ width: 6, height: 6, display: 'inline-block', marginRight: 4 }}></span>
              Flagged ({availableSites.filter((s) => ['yellow', 'orange', 'red', 'purple'].includes(s.signal)).length})
            </button>
            {availableSites.some((s) => s.ganga) && (
              <button
                type="button"
                className={`btn btn-sm ${filterCategory === 'ganga' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: 11, padding: '2px 8px', height: 24 }}
                onClick={() => setFilterCategory('ganga')}
              >
                GPI Ganga ({availableSites.filter((s) => s.ganga).length})
              </button>
            )}
          </div>

          {/* Site Results List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
            {filteredSites.map((s) => {
              const isSelected = s.id === siteId;
              const paramNames = (s.params || [])
                .map((p) => (p.key === 'SO2' ? 'SOX' : p.key))
                .slice(0, 5)
                .join(', ');
              const paramCount = s.params?.length || 0;

              return (
                <div
                  key={s.id}
                  onClick={() => {
                    setSiteId(s.id);
                    setPreview(null);
                    setShowSearchModal(false);
                    toast.success(`Selected: ${s.name} (${s.id})`);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
                    background: isSelected ? 'var(--primary-soft, rgba(16, 185, 129, 0.08))' : 'var(--surface)',
                    cursor: 'pointer',
                    transition: 'border-color 140ms, background 140ms',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'var(--surface-2)';
                      e.currentTarget.style.borderColor = 'var(--primary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'var(--surface)';
                      e.currentTarget.style.borderColor = 'var(--border)';
                    }
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1, marginRight: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span
                        className={'status-dot ' + s.signal}
                        style={{ width: 8, height: 8 }}
                      ></span>
                      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
                        {s.name}
                      </span>
                      {s.deviceType && s.deviceType !== s.name && (
                        <span className="badge" style={{ fontSize: 9.5, padding: '1px 6px', background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
                          {s.deviceType}
                        </span>
                      )}
                      {s.ganga && (
                        <span className="badge" style={{ fontSize: 9.5, padding: '1px 6px', background: 'var(--accent, #0284c7)', color: '#fff' }}>
                          GPI Ganga
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="mono" style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.id}</span>
                      <span>·</span>
                      <span>{s.sector || 'Industrial'}</span>
                      <span>·</span>
                      <span>{s.loc || '—'}</span>
                      {s.spcb && <><span>·</span><span>SPCB: {s.spcb}</span></>}
                    </div>

                    {paramCount > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 3 }}>
                        <span style={{ fontWeight: 500, color: 'var(--ink-3)' }}>{paramCount} parameters:</span> {paramNames}
                        {paramCount > 5 ? '…' : ''}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isSelected ? (
                      <span className="badge" style={{ background: 'var(--primary)', color: '#fff', fontSize: 11, padding: '3px 8px', fontWeight: 600 }}>
                        ✓ Selected
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11, height: 26, padding: '0 8px' }}
                      >
                        Select
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {filteredSites.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--ink-3)' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
                <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14 }}>No sites found</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  No sites matched &ldquo;{searchQuery}&rdquo;
                </div>
                {searchQuery && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setSearchQuery('')}
                    style={{ marginTop: 12 }}
                  >
                    Clear Search
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}