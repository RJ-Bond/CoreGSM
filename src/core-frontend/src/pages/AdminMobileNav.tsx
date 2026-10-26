// A phone shows the admin sections as one button (the current section) that opens the list of all of them,
// instead of a strip of tabs with clipped labels.
import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../i18n';
import type { AdminSection } from './adminNav';

export interface MobileNavGroup { key: string; title?: string; sections: AdminSection[] }
export interface MobileNavBadge { n: number; tone: 'bad' | 'warn'; label: string }

export default function AdminMobileNav({ groups, current, badges, fallbackLabel }: {
  groups: MobileNavGroup[];
  current: string;
  badges: Record<string, MobileNavBadge>;
  fallbackLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const all = groups.flatMap((g) => g.sections);
  const cur = all.find((s) => s.id === current);
  // the list closes on navigation, on Esc and on a tap outside of it
  useEffect(() => { setOpen(false); }, [current]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); }
    };
    const onDown = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    root.current?.querySelector<HTMLElement>('a[aria-current="page"], a')?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);
  const total = Object.values(badges).reduce((n, b) => n + (b.n || 1), 0);
  return (
    <div ref={root} className="adm-mnav md:hidden">
      <button ref={btn} type="button" className="adm-mnav-btn" aria-expanded={open} aria-controls={panelId} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        <span className="adm-ic" aria-hidden>{cur?.icon()}</span>
        <span className="min-w-0 flex-1 truncate text-left">{cur?.label ?? fallbackLabel}</span>
        {!open && total > 0 && <span className="adm-badge is-warn" aria-label={t('adm.mnav.attention')}>{total}</span>}
        <span aria-hidden className="adm-mnav-chev" data-open={open ? 'true' : undefined}>▾</span>
        <span className="sr-only">{t('adm.mnav.all')}</span>
      </button>
      {open && (
        <div id={panelId} className="adm-mnav-pop" role="group" aria-label={t('adm.navLabel')}>
          {groups.map((g) => (
            <div key={g.key}>
              {g.title && <div className="adm-group-title">{g.title}</div>}
              {g.sections.map((s) => {
                const b = badges[s.id];
                return (
                  <a key={s.id} href={`/admin/${s.id}`} className="adm-mnav-link" aria-current={current === s.id ? 'page' : undefined}>
                    <span className="adm-ic" aria-hidden>{s.icon()}</span>
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    {b && (b.n === 0
                      ? <span className={`adm-dot is-${b.tone}`} role="img" aria-label={b.label} />
                      : <span className={`adm-badge is-${b.tone}`} aria-label={b.label}>{b.n}</span>)}
                  </a>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
