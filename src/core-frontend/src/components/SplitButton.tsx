import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { BtnSpinner } from './Button';

export interface SplitItem {
  key: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * Main action plus a chevron that opens a menu of related actions.
 * Menu button pattern: aria-haspopup, ArrowDown/Enter/Space open and focus the first item, arrows/Home/End move,
 * Esc closes and returns focus to the chevron, Tab and a click outside close.
 */
export function SplitButton({
  label,
  onClick,
  items,
  disabled,
  loading,
  className = '',
  menuLabel = 'Другие действия',
  magnetic = false,
  children,
}: {
  label: ReactNode;
  onClick: () => void;
  items: SplitItem[];
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  menuLabel?: string;
  magnetic?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusFirst = useRef<'first' | 'last' | null>(null);
  const menuId = useId();
  const off = !!disabled || !!loading;

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) caret.current?.focus();
  };
  const show = (which: 'first' | 'last') => {
    if (off) return;
    // open upwards when the menu would not fit under the button
    const r = caret.current?.getBoundingClientRect();
    setUp(!!r && window.innerHeight - r.bottom < 40 + items.length * 56 && r.top > window.innerHeight - r.bottom);
    focusFirst.current = which;
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const els = menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)');
    if (els && els.length) (focusFirst.current === 'last' ? els[els.length - 1] : els[0]).focus();
    focusFirst.current = null;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onCaretKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); show('first'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); show('last'); }
  };
  const onMenuKey = (e: ReactKeyboardEvent) => {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); els[(n + els.length) % els.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={root} className={`split ${className}`} data-magnetic={magnetic || undefined}>
      <button type="button" className="btn split-main" disabled={off} aria-busy={loading || undefined} onClick={onClick}>
        {loading && <BtnSpinner />}
        {label}
      </button>
      <button
        ref={caret}
        type="button"
        className="btn split-caret"
        disabled={off}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={menuLabel}
        onClick={() => (open ? close(false) : show('first'))}
        onKeyDown={onCaretKey}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div ref={menu} id={menuId} role="menu" aria-label={menuLabel} data-up={up} className="split-menu" onKeyDown={onMenuKey}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className="split-item"
              disabled={it.disabled}
              onClick={() => { close(true); it.onSelect(); }}
            >
              {it.label}
              {it.hint && <small>{it.hint}</small>}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
