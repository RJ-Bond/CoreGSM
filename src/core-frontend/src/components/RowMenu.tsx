// A «⋯» button that opens a small menu of text actions. The popup is drawn on the page body (a scrolling table would clip it)
// and is operated from the keyboard: ↑/↓, Home/End, Esc closes and returns the focus, Tab closes.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface RowMenuItem {
  key: string;
  label: string;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  /** a divider is drawn above the item */
  sep?: boolean;
}

export default function RowMenu({ label, items, className = '' }: { label: string; items: RowMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = (focus = false) => { setOpen(false); if (focus) btn.current?.focus(); };

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    // opens upwards when there is no room under the button
    setPos(r.bottom + 260 > window.innerHeight && r.top > 260 ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    const onDown = (e: Event) => {
      const n = e.target as Node;
      if (!pop.current?.contains(n) && !btn.current?.contains(n)) setOpen(false);
    };
    const away = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => { document.removeEventListener('pointerdown', onDown); window.removeEventListener('scroll', away, true); window.removeEventListener('resize', away); };
  }, [open, pos]);

  const onKey = (e: KeyboardEvent) => {
    const els = [...(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close();
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`row-act ${className}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
      >
        <span aria-hidden className="text-lg font-black leading-none">⋯</span>
      </button>
      {open && pos && createPortal(
        <div ref={pop} id={id} role="menu" aria-label={label} className="row-menu" style={pos} onKeyDown={onKey}>
          {items.map((it) => {
            const common = {
              role: 'menuitem',
              'aria-disabled': it.disabled || undefined,
              tabIndex: -1,
              className: `row-menu-item ${it.danger ? 'is-danger' : ''}`,
              'data-sep': it.sep ? 'true' : undefined,
            } as const;
            return it.href && !it.disabled ? (
              <a key={it.key} {...common} href={it.href} onClick={() => close()}>{it.label}</a>
            ) : (
              <button key={it.key} type="button" {...common} onClick={() => { if (it.disabled) return; close(); it.onSelect?.(); }}>{it.label}</button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
