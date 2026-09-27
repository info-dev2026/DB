import { useState } from 'react';
import toast from 'react-hot-toast';
import { mockApi } from '../api/mockApi';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { fmtDay } from '../utils/formatters';
import { PARAMS } from '../utils/cpcb';
import Panel from '../components/UI/Panel';

export default function Reports() {
  const { session } = useAuth();
  const { sites } = useData();

  const availableSites =
    session?.role === 'industry'
      ? sites.filter((s) => s.id === session.siteId)
      : sites;

  const [siteId, setSiteId] = useState(availableSites[0]?.id || '');
  const [period, setPeriod] = useState('daily');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

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
    const { readings } = await mockApi.getReportData({
      siteId,
      from: range.from,
      to: range.to,
    });
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
      const site = sites.find((s) => s.id === siteId);
      const filename = `${siteId}_${period}_OCEMS.${fmt === 'pdf' ? 'pdf' : 'xlsx'}`;

      const grouped = {};
      data.readings.forEach((r) => {
        const k = r.ts;
        grouped[k] = grouped[k] || { ts: r.ts };
        grouped[k][r.param] = r.value;
      });
      const rows = Object.values(grouped).sort((a, b) => a.ts - b.ts);
      const paramKeys =
        site?.params.map((p) => p.key) ||
        [...new Set(data.readings.map((r) => r.param))];

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
            o[k] = r[k];
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

        const head = [['Timestamp', ...paramKeys]];
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
        grouped[k] = grouped[k] || { ts: r.ts };
        grouped[k][r.param] = r.value;
      });
      setPreview({
        siteId,
        range: data.range,
        rows: Object.values(grouped)
          .sort((a, b) => a.ts - b.ts)
          .slice(0, 80),
        params: Object.keys(PARAMS),
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

      <Panel title="Generate Data Report" hint="Select site and period">
        <div className="form-grid">
          <div className="fg">
            <label>Site</label>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {availableSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
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
                  {preview.params.map((k) => (
                    <th key={k}>{k}</th>
                  ))}
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
                      return (
                        <td
                          key={k}
                          className={'mono ' + (exc ? 'val-exc' : '')}
                        >
                          {v ?? '—'}
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
    </>
  );
}