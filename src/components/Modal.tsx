import { useEffect, useRef, useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
let openModalCount = 0;
function lockPageScroll() {
  openModalCount++;
  document.documentElement.classList.add('has-open-modal');
  return () => {
    openModalCount--;
    if (openModalCount === 0) document.documentElement.classList.remove('has-open-modal');
  };
}
export function Modal({ title, onClose, children, busy = false, className = '' }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const unlock = lockPageScroll();
    return () => { dialog.close(); unlock(); };
  }, []);
  return <dialog ref={ref} className={`manage-dialog ${className}`} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="manage-dialog-content"><div className="dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="关闭" onClick={onClose} disabled={busy}><X size={20} /></button></div><div className="manage-dialog-body">{children}</div></div>
  </dialog>;
}
