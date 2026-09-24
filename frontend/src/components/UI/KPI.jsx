import Sparkline from './Sparkline';

/* <KPI color="g" label="Compliant" value={5} desc="Within limits" trend={[1,2,3,4,5]} /> */
export default function KPI({ color = 'g', label, value, desc, trend }) {
  return (
    <div className={'kpi ' + color}>
      <div className="kpi-rail"></div>

      <div className="kpi-label">{label}</div>

      <div className="kpi-value-row">
        <div className="kpi-value">{value}</div>
        {trend && trend.length > 1 && <Sparkline data={trend} width={56} height={20} />}
      </div>

      {desc ? (
        <div className="kpi-desc">
          <span className="dot"></span>
          <span>{desc}</span>
        </div>
      ) : null}
    </div>
  );
}