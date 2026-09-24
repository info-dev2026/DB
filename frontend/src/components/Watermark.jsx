export default function Watermark() {
  return (
    <div className="wm-center" aria-hidden="true">
      <img
        src="/logo.png"
        alt=""
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    </div>
  );
}