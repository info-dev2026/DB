/* <Panel title="All Sites" hint="8 connected" right={<button>…</button>}>
     {children}
   </Panel>

   body="flush" → no padding on .panel-b (used for tables)
   body="none"  → no .panel-b wrapper at all (used for map)
*/
export default function Panel({
  title,
  hint,
  right,
  children,
  body = 'pad',
  style = {},
  headerStyle = {},
}) {
  return (
    <div className="panel" style={style}>
      {(title || right) && (
        <div className="panel-h" style={headerStyle}>
          <div>
            {title && <h3>{title}</h3>}
          </div>
          {hint && !right ? <span className="hint">{hint}</span> : null}
          {right}
        </div>
      )}

      {body === 'none' ? (
        children
      ) : (
        <div className={body === 'flush' ? '' : 'panel-b'}>{children}</div>
      )}
    </div>
  );
}