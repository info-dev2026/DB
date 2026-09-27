import { PARAMS } from '../utils/cpcb';
import Panel from '../components/UI/Panel';

export default function Parameters() {
  const entries = Object.entries(PARAMS);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Monitoring Parameters</div>
          <div className="page-sub">
            <span>{entries.length} parameters registered</span>
            <span>·</span>
            <span>Param ID = SITE-CODE + suffix</span>
          </div>
        </div>
      </div>

      <Panel
        title="Parameter Registry"
        hint="Each site inherits these definitions"
        body="flush"
      >
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
              </tr>
            </thead>
            <tbody>
              {entries.map(([k, n]) => {
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
                              : 'var(--primary)',
                        }}
                      >
                        {n.type === 'stack' ? 'Emission' : 'Effluent'}
                      </span>
                    </td>
                    <td className="mono">
                      {n.ph ? `${n.min}–${n.limit}` : `≤ ${n.limit} ${n.unit}`}
                    </td>
                    <td className="mono">
                      {n.ph ? 'pH <4 / >12' : `±${n.dev}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
            CPCB grading engine compares each reading against the parameter's{' '}
            <b>limit</b> and the <b>deviation band</b> to determine whether the
            parameter is within limits, in warning, or in exceedance.
          </p>
          <p style={{ marginTop: 12 }}>
            <b>Emission</b> parameters are measured at stacks (PM, SO₂, NOₓ, CO,
            Flow, Temperature, Pressure). <b>Effluent</b> parameters are measured
            at ETP outlets (pH, BOD, COD, TSS, TOC).
          </p>
        </div>
      </Panel>
    </>
  );
}