import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';

/**
 * The rare and risky actions behind a «⋯» button: it closes on Esc, on a click outside and after a choice.
 * `plain`: the button is a quiet chip on an ordinary card and the menu opens downwards (the default is a chip on a
 * gradient and a menu that opens upwards).
 */
export function MoreMenu({ children, plain = false }: { children: (close: () => void) => ReactNode; plain?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className={`upd-more ${plain ? 'is-plain' : ''}`} ref={box}>
      <button type="button" className="upd-more-btn" aria-haspopup="menu" aria-expanded={open} aria-label={t('upd.more')} title={t('upd.more')} onClick={() => setOpen((v) => !v)}>⋯</button>
      {open && <div className="upd-more-menu" role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}
