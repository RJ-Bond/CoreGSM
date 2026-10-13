import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { tabHref, type TabId } from './helpers';

export const TAB_LIST: { id: TabId; label: string }[] = [
  { id: '', label: 'Обзор' },
  { id: 'players', label: 'Игроки' },
  { id: 'history', label: 'История' },
  { id: 'events', label: 'События' },
  { id: 'connect', label: 'Подключение' },
];

export const tabDomId = (id: TabId) => `srv-tab-${id || 'overview'}`;
export const panelDomId = (id: TabId) => `srv-panel-${id || 'overview'}`;

/**
 * Tab strip of the server page: a sliding `.seg` capsule, sticky under the glass header, scrolls sideways on phones
 * (the active tab is centred). Tabs are links, so the address bar and the back button work.
 */
export default function ServerTabs({ id, tab, counts, toc }: { id: number; tab: TabId; counts: Partial<Record<TabId, number>>; toc?: ReactNode }) {
  const seg = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const [top, setTop] = useState(72);

  // sticky offset = bottom edge of the (sticky) glass header
  useLayoutEffect(() => {
    const hdr = document.querySelector<HTMLElement>('header.glass');
    if (!hdr) return;
    const measure = () => setTop(Math.round(parseFloat(getComputedStyle(hdr).top || '0') + hdr.offsetHeight + 8));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(hdr);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  // «stuck» styling: the sentinel above the bar scrolls under the header
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { rootMargin: `-${top}px 0px 0px 0px`, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [top]);

  // the active tab scrolls into view inside the strip
  useEffect(() => {
    const s = seg.current;
    const on = s?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!s || !on || s.scrollWidth <= s.clientWidth) return;
    const left = on.offsetLeft - (s.clientWidth - on.offsetWidth) / 2;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';
    s.scrollTo({ left: Math.max(0, left), behavior: reduce ? 'auto' : 'smooth' });
  }, [tab]);

  const onKey = (e: ReactKeyboardEvent) => {
    const i = TAB_LIST.findIndex((t) => t.id === tab);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % TAB_LIST.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + TAB_LIST.length) % TAB_LIST.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TAB_LIST.length - 1;
    if (n < 0) return;
    e.preventDefault();
    window.location.hash = tabHref(id, TAB_LIST[n].id);
    // the focus follows the selected tab
    requestAnimationFrame(() => document.getElementById(tabDomId(TAB_LIST[n].id))?.focus({ preventScroll: true }));
  };

  return (
    <>
      <div ref={sentinel} aria-hidden className="h-px" />
      <div className={`srv-tabbar sticky z-20 -mx-3 px-3 py-2 sm:-mx-6 sm:px-6 ${stuck ? 'is-stuck' : ''}`} style={{ top }}>
        <nav
          ref={seg}
          className="seg no-scrollbar flex w-fit max-w-full overflow-x-auto"
          role="tablist"
          aria-label="Разделы сервера"
          onKeyDown={onKey}
        >
          {TAB_LIST.map((t) => {
            const on = t.id === tab;
            const n = counts[t.id];
            return (
              <a
                key={t.id || 'overview'}
                id={tabDomId(t.id)}
                role="tab"
                href={tabHref(id, t.id)}
                aria-selected={on}
                aria-controls={panelDomId(t.id)}
                tabIndex={on ? 0 : -1}
                className={`seg-item shrink-0 ${on ? 'on' : ''}`}
              >
                {t.label}
                {n != null && n > 0 && <span className="tab-count">{n}</span>}
              </a>
            );
          })}
        </nav>
        {toc}
      </div>
    </>
  );
}
