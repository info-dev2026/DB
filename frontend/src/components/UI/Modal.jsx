import { useEffect } from 'react';

/* <Modal open title="Raise a Complaint" onClose={fn} footer={<button>…</button>}>
     {children}
   </Modal> */
export default function Modal({ open, title, onClose, footer, children, width = 520 }) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}>
      <div className="modal" style={{ maxWidth: width }}>
        <div className="modal-h">
          <h3>{title}</h3>
          <span className="modal-x" onClick={onClose}>×</span>
        </div>
        <div className="modal-b">{children}</div>
        {footer ? <div className="modal-f">{footer}</div> : null}
      </div>
    </div>
  );
}