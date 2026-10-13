import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { IconChevronDown } from '../../icons';

/**
 * Long server pages: sections that fold, a mini table of contents (chips) that scrolls inside the page, and a memory of
 * what was folded. The hash route is never touched (no «#section» links): chips are buttons that scroll to an element id.
 * Secondary blocks start folded on phones; whatever the user changes afterwards is remembered per section.
 */
const KEY = 'coregsm_srv_sections';

const PHONE = '(max-width: 639px)';
const onPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE).matches;

function readStore(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: Record<string, boolean> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === 'boolean') out[k] = x;
      return out;
    }
  } catch {
    /* no storage: nothing is remembered */
  }
  return {};
}

function writeStore(v: Record<string, boolean>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

export interface SectionDef {
  id: string;
  label: string;
  /** folded by default on phones */
  secondary?: boolean;
}

export const sectionDomId = (id: string) => `srv-s-${id}`;

/** the fold state of a set of sections; `defs` decides the defaults for those the user has not touched */
export function useSectionState(defs: SectionDef[]) {
  const [store, setStore] = useState<Record<string, boolean>>(readStore);
  const defsRef = useRef(defs);
  defsRef.current = defs;

  const collapsed = useCallback((id: string): boolean => {
    if (id in store) return store[id];
    return !!defsRef.current.find((d) => d.id === id)?.secondary && onPhone();
  }, [store]);

  const set = useCallback((id: string, value: boolean) => {
    setStore((prev) => {
      const next = { ...prev, [id]: value };
      writeStore(next);
      return next;
    });
  }, []);

  const toggle = useCallback((id: string) => set(id, !collapsed(id)), [set, collapsed]);
  return { collapsed, toggle, set };
}

export type SectionState = ReturnType<typeof useSectionState>;

/** a card (or a bare block) whose title is a button: aria-expanded, Enter / Space fold it */
export function SectionCard({
  id, title, state, actions, bare = false, className = '', style, children, as: Tag = 'section',
}: {
  id: string;
  title: ReactNode;
  state: SectionState;
  /** controls that sit next to the title (period switch ...); hidden while the section is folded */
  actions?: ReactNode;
  /** no card of its own: the children bring their tiles */
  bare?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  as?: 'section' | 'div';
}) {
  const closed = state.collapsed(id);
  const bodyId = `${sectionDomId(id)}-body`;
  return (
    <Tag id={sectionDomId(id)} className={`srv-sec ${bare ? 'srv-sec-bare' : 'tile tile-in p-4 sm:p-5'} ${closed ? 'is-closed' : ''} ${className}`} style={style} tabIndex={-1}>
      <div className="srv-sec-head">
        <h2 className="min-w-0 text-base font-extrabold">
          <button type="button" className="srv-sec-btn" aria-expanded={!closed} aria-controls={bodyId} onClick={() => state.toggle(id)}>
            <span className="min-w-0">{title}</span>
            <IconChevronDown size={18} className="srv-sec-chev" />
          </button>
        </h2>
        {!closed && actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div id={bodyId} hidden={closed} className="srv-sec-body">{children}</div>
    </Tag>
  );
}

/** scrolls to a section (unfolding it first) below the sticky tab bar and moves the focus there */
export function goToSection(state: SectionState, id: string) {
  if (state.collapsed(id)) state.set(id, false);
  window.requestAnimationFrame(() => {
    const el = document.getElementById(sectionDomId(id));
    if (!el) return;
    const bar = document.querySelector<HTMLElement>('.srv-tabbar');
    const offset = (bar ? bar.getBoundingClientRect().bottom : 72) + 8;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset), behavior: reduce ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  });
}

/** the chips: one per section; the one being read is marked */
export function SectionChips({ defs, state }: { defs: SectionDef[]; state: SectionState }) {
  const [current, setCurrent] = useState(defs[0]?.id ?? '');
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const bar = document.querySelector<HTMLElement>('.srv-tabbar');
      const line = (bar ? bar.getBoundingClientRect().bottom : 72) + 24;
      let cur = defs[0]?.id ?? '';
      for (const d of defs) {
        const el = document.getElementById(sectionDomId(d.id));
        if (el && el.getBoundingClientRect().top <= line) cur = d.id;
      }
      setCurrent(cur);
    };
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [defs]);

  if (defs.length < 2) return null;
  return (
    <nav className="srv-chips no-scrollbar" aria-label="Блоки страницы">
      {defs.map((d) => (
        <button
          key={d.id}
          type="button"
          className="srv-chip"
          aria-current={current === d.id ? 'true' : undefined}
          data-closed={state.collapsed(d.id) ? 'true' : undefined}
          onClick={() => goToSection(state, d.id)}
        >
          {d.label}
        </button>
      ))}
    </nav>
  );
}
