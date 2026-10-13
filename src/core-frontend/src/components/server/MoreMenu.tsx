import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { t, useI18n } from '../../i18n';

export interface MoreItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** a thin line above the item */
  divider?: boolean;
}

/**
 * «Ещё»: a menu button with a popover. Keyboard: Enter / Space / ArrowDown open it, arrows / Home / End move, Esc closes
 * and returns the focus; a click outside closes it. The popover is positioned inside the page (not clipped by the
 * banner: the banner itself does not clip) and flips to the left edge when it would leave the screen.
 */
export default function MoreMenu({ items, className = 'btn-glass' }: { items: MoreItem[]; className?: string }) {
  useI18n();
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = (focusBack = true) => {
    setOpen(false);
    if (focusBack) btn.current?.focus();
  };
  const focusItem = (i: number) => {
    const els = Array.from(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    if (!els.length) return;
    els[(i + els.length) % els.length]?.focus();
  };

  // the first item gets the focus when the menu opens with the keyboard (and always: it is cheap and harmless for a mouse)
  useEffect(() => {
    if (open) focusItem(0);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !pop.current) { setFlip(false); return; }
    const r = pop.current.getBoundingClientRect();
    if (r.left < 8) setFlip(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down, { passive: true });
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); };
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent) => {
    const els = Array.from(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(i < 0 ? -1 : i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(-1); }
    else if (e.key === 'Tab') setOpen(false);
  };

  if (!items.length) return null;
  return (
    <div ref={root} className="srv-more">
      <button
        ref={btn}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
        {t('srv.more')}
      </button>
      {open && (
        <div ref={pop} id={id} role="menu" aria-label={t('srv.more')} className={`srv-more-pop ${flip ? 'is-flip' : ''}`} onKeyDown={onMenuKey}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={it.disabled}
              className={`srv-more-item ${it.danger ? 'is-danger' : ''} ${it.divider ? 'has-divider' : ''}`}
              onClick={() => { close(); it.onSelect(); }}
            >
              {it.icon && <span className="srv-more-ico" aria-hidden>{it.icon}</span>}
              <span className="min-w-0 flex-1 text-left">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
