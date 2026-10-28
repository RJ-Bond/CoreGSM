import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { IconBars, IconBolt, IconGrid, IconPlug, IconTrend, IconUsers, type IconProps } from '../../icons';
import { navigate } from '../../ui/route';
import { t, useI18n, type TKey } from '../../i18n';
import { tabHref, type TabId } from './helpers';

export const TAB_LIST: { id: TabId; label: TKey; icon: ComponentType<IconProps> }[] = [
  { id: '', label: 'd2.tabs.overview', icon: IconGrid },
  { id: 'players', label: 'd2.an.players', icon: IconUsers },
  { id: 'history', label: 'd2.tabs.history', icon: IconTrend },
  { id: 'stats', label: 'd2.tabs.stats', icon: IconBars },
  { id: 'events', label: 'd2.sd.sec.events', icon: IconBolt },
  { id: 'connect', label: 'd2.tabs.connect', icon: IconPlug },
];

export const tabDomId = (id: TabId) => `srv-tab-${id || 'overview'}`;
export const panelDomId = (id: TabId) => `srv-panel-${id || 'overview'}`;

/**
 * Tab strip of the server page: a sliding `.seg` capsule, sticky under the glass header, scrolls sideways on phones
 * (the active tab is centred). Tabs are links, so the address bar and the back button work.
 */
export default function ServerTabs({ id, tab, counts, toc, mini }: { id: number; tab: TabId; counts: Partial<Record<TabId, number>>; toc?: ReactNode; mini?: ReactNode }) {
  useI18n();
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
    navigate(tabHref(id, TAB_LIST[n].id));
    // the focus follows the selected tab
    requestAnimationFrame(() => document.getElementById(tabDomId(TAB_LIST[n].id))?.focus({ preventScroll: true }));
  };

  return (
    <>
      <div ref={sentinel} aria-hidden className="h-px" />
      <div className={`srv-tabbar sticky z-20 -mx-3 px-3 py-2 sm:-mx-6 sm:px-6 ${stuck ? 'is-stuck' : ''}`} style={{ top }}>
        <nav
          ref={seg}
          className="srv-tabs seg fade-x no-scrollbar flex w-fit max-w-full overflow-x-auto"
          role="tablist"
          aria-label={t('d2.tabs.label')}
          onKeyDown={onKey}
        >
          {TAB_LIST.map((tb) => {
            const on = tb.id === tab;
            const n = counts[tb.id];
            return (
              <a
                key={tb.id || 'overview'}
                id={tabDomId(tb.id)}
                role="tab"
                href={tabHref(id, tb.id)}
                aria-selected={on}
                aria-controls={panelDomId(tb.id)}
                tabIndex={on ? 0 : -1}
                className={`seg-item shrink-0 ${on ? 'on' : ''}`}
              >
                <tb.icon size={17} className="srv-tab-i" />
                {t(tb.label)}
                {n != null && n > 0 && <span className="tab-count">{n}</span>}
              </a>
            );
          })}
        </nav>
        {toc}
        {/* once the banner is scrolled away, the name and the players stay in sight (wide screens) */}
        {stuck && mini && <div className="srv-mini-wrap">{mini}</div>}
      </div>
    </>
  );
}
