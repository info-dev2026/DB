import { SIG_LABEL } from '../../utils/cpcb';

/* Solid coloured badge (used for complaint status, service status, etc.) */
export function Badge({ level = 'grey', label, style = {} }) {
  return (
    <span className={'badge ' + level} style={style}>
      {label || SIG_LABEL[level] || level}
    </span>
  );
}

/* Dot + label pill — cleaner than badge for status columns */
export function StatusPill({ level = 'grey', label, style = {} }) {
  return (
    <span className="status-pill" style={style}>
      <span className={'status-dot ' + level}></span>
      <span>{label || SIG_LABEL[level] || level}</span>
    </span>
  );
}

/* Just the dot (used inside tables) */
export function StatusDot({ level = 'grey' }) {
  return <span className={'status-dot ' + level}></span>;
}

export default Badge;