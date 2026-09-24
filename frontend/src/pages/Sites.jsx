import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { RANK, SIG_LABEL } from '../utils/cpcb';
import Panel from '../components/UI/Panel';

export default function Sites() {
  const { sites } = useData();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    let l = sites.slice().sort((a, b) => (RANK[b.signal] || 0) - (RANK[a.signal] || 0));
    if (q.trim()) {
      const ql = q.trim().toLowerCase();
      l = l.filter(
        (s) =>
          s.name.toLowerCase().includes(ql) ||
          s.id.toLowerCase().includes(ql) ||
          (s.sector || '').toLowerCase().includes(ql) ||
          (s.loc || '').toLowerCase().includes(ql)
      );
    }
    return l;
  }, [sites, q]);

  /* status count summary */
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

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Sites</div>
          <div className="page-sub">
            <span>{counts.total} connected</span>
            <span>·</span>
            <span>{counts.exceed} non-compliant</span>
          </div>
        </div>
      </div>

      <Panel
        title="All Sites"
        hint={`${list.length} shown`}
        right={
          <input
            className="search"
            placeholder="Search by site, code, sector, location…"
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
                <th style={{ width: '30%' }}>Site</th>
                <th>Code</th>
                <th>Sector</th>
                <th>SPCB</th>
                <th>Params</th>
                <th>Status</th>
                <th>Last update</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <div className="empty">No site matches “{q}”.</div>
                  </td>
                </tr>
              ) : (
                list.map((s) => (
                  <tr
                    key={s.id}
                    className="rowlink"
                    onClick={() => navigate('/sites/' + s.id)}
                  >
                    <td>
                      <b>{s.name}</b>
                      <br />
                      <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>
                        {s.loc || '—'}
                      </span>
                    </td>
                    <td className="mono">{s.id}</td>
                    <td>{s.sector || '—'}</td>
                    <td>{s.spcb || '—'}</td>
                    <td className="mono">{s.params?.length || 0}</td>
                    <td>
                      <span className="status-pill">
                        <span className={'status-dot ' + s.signal}></span>
                        {SIG_LABEL[s.signal]}
                      </span>
                    </td>
                    <td className="mono" style={{ color: 'var(--ink-3)' }}>
                      {s.lastData || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}