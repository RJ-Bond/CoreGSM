import * as Popover from '@radix-ui/react-popover';
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
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
 * «Ещё»: a menu button with a popover (Radix Popover: outside click, Esc, focus return and collision flipping come from it).
 * Keyboard: Enter / Space / ArrowDown open it, arrows / Home / End move between the items. The popover stays inside the
 * page (no portal) and is aligned to the right edge of the button.
 */
export default function MoreMenu({ items, className = 'btn-glass', iconOnly = false, label }: { items: MoreItem[]; className?: string; /** only the dots, the name goes to aria-label */ iconOnly?: boolean; label?: string }) {
  useI18n();
  const [open, setOpen] = useState(false);
  const pop = useRef<HTMLDivElement>(null);

  const focusItem = (i: number) => {
    const els = Array.from(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    if (!els.length) return;
    els[(i + els.length) % els.length]?.focus();
  };

  const onMenuKey = (e: ReactKeyboardEvent) => {
    const els = Array.from(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(i < 0 ? -1 : i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(-1); }
    else if (e.key === 'Tab') setOpen(false);
  };

  // on a card (overflow hidden) the list goes to the body, or it would be cut off
  const wrap = (node: ReactNode) => (iconOnly ? <Popover.Portal>{node}</Popover.Portal> : node);
  if (!items.length) return null;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="srv-more">
        <Popover.Trigger asChild>
          <button
            type="button"
            className={className}
            aria-haspopup="menu"
            aria-label={iconOnly ? (label ?? t('srv.more')) : undefined}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
            {!iconOnly && t('srv.more')}
          </button>
        </Popover.Trigger>
        {wrap(
        <Popover.Content
          ref={pop}
          role="menu"
          aria-label={t('srv.more')}
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="srv-more-pop"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onMenuKey}
          onOpenAutoFocus={(e) => { e.preventDefault(); focusItem(0); }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={it.disabled}
              className={`srv-more-item ${it.danger ? 'is-danger' : ''} ${it.divider ? 'has-divider' : ''}`}
              onClick={() => { setOpen(false); it.onSelect(); }}
            >
              {it.icon && <span className="srv-more-ico" aria-hidden>{it.icon}</span>}
              <span className="min-w-0 flex-1 text-left">{it.label}</span>
            </button>
          ))}
        </Popover.Content>,
        )}
      </div>
    </Popover.Root>
  );
}
