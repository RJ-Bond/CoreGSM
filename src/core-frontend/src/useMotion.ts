import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';

// Small motion helpers: no animation library, CSS does the painting. Everything here is a no-op for
// prefers-reduced-motion and for coarse pointers, and nothing throws where an API is missing.

/** the OS setting, or «Меньше движения» chosen in the profile (data-motion on <html>) */
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && (document.documentElement.dataset.motion === 'reduce' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export const hasFinePointer = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

// ---------- magnetic call-to-action buttons: [data-magnetic] leans up to 6 px toward a mouse pointer ----------
let magneticOn = false;
/** off: buttons do not move any more (black-square rules: no translate on buttons); the data-magnetic attribute stays in the markup */
const MAGNETIC_ENABLED = false as boolean;

/** Call once. Elements opt in with the `data-magnetic` attribute (the Button component has a `magnetic` prop). */
export function installMagnetic() {
  if (!MAGNETIC_ENABLED || magneticOn || typeof window === 'undefined') return;
  magneticOn = true;
  const MAX = 6;
  const REACH = 26;
  let raf = 0;
  let px = -9999;
  let py = -9999;

  const settle = (el: HTMLElement) => {
    if (el.style.translate) el.style.translate = '';
  };
  const frame = () => {
    raf = 0;
    const on = hasFinePointer() && !prefersReducedMotion();
    document.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((el) => {
      if (!on || el.hasAttribute('disabled')) return settle(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      // the box already moved by the current shift; measure the resting centre
      const cur = (el.dataset.mag ?? '0,0').split(',').map(Number);
      const cx = r.left + r.width / 2 - (cur[0] || 0);
      const cy = r.top + r.height / 2 - (cur[1] || 0);
      const hw = r.width / 2 + REACH;
      const hh = r.height / 2 + REACH;
      const dx = px - cx;
      const dy = py - cy;
      if (Math.abs(dx) > hw || Math.abs(dy) > hh) {
        el.dataset.mag = '0,0';
        return settle(el);
      }
      const tx = Math.max(-MAX, Math.min(MAX, (dx / hw) * MAX * 1.4));
      const ty = Math.max(-MAX, Math.min(MAX, (dy / hh) * MAX * 1.4));
      el.dataset.mag = `${tx.toFixed(1)},${ty.toFixed(1)}`;
      el.style.translate = `${tx.toFixed(1)}px ${ty.toFixed(1)}px`;
    });
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(frame); };

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    px = e.clientX;
    py = e.clientY;
    schedule();
  }, { passive: true });
  document.addEventListener('mouseleave', () => { px = -9999; py = -9999; schedule(); });
  window.addEventListener('blur', () => { px = -9999; py = -9999; schedule(); });
}

// ---------- segmented controls: the active pill slides ----------
let segOn = false;

/** Call once. Measures the active `.seg-item` of every `.seg` and publishes its box as CSS variables for the sliding pill. */
export function installSegIndicator() {
  if (segOn || typeof window === 'undefined') return;
  segOn = true;
  let raf = 0;
  const run = () => {
    raf = 0;
    document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      const on = seg.querySelector<HTMLElement>('.seg-item[aria-pressed="true"], .seg-item[aria-current="page"], .seg-item.on');
      if (!on || on.offsetWidth === 0) {
        if (seg.hasAttribute('data-ind')) { seg.removeAttribute('data-ind'); seg.removeAttribute('data-ind-anim'); }
        return;
      }
      seg.style.setProperty('--ind-x', `${on.offsetLeft}px`);
      seg.style.setProperty('--ind-y', `${on.offsetTop}px`);
      seg.style.setProperty('--ind-w', `${on.offsetWidth}px`);
      seg.style.setProperty('--ind-h', `${on.offsetHeight}px`);
      if (!seg.hasAttribute('data-ind')) {
        seg.setAttribute('data-ind', '');
        // transitions start only after the first position is painted, so the pill does not fly in from the corner
        requestAnimationFrame(() => requestAnimationFrame(() => seg.setAttribute('data-ind-anim', '')));
      }
    });
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(run); };
  new MutationObserver(schedule).observe(document.body, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-current', 'class'],
  });
  window.addEventListener('resize', schedule);
  void document.fonts?.ready.then(schedule);
  schedule();
}

// ---------- View Transitions ----------
interface ViewTransitionLike { finished: Promise<unknown>; ready: Promise<unknown>; skipTransition?: () => void }
type StartVT = (cb: () => void) => ViewTransitionLike;
const startVT = (): StartVT | null => {
  const d = document as Document & { startViewTransition?: StartVT };
  return typeof d.startViewTransition === 'function' ? d.startViewTransition.bind(document) : null;
};

/**
 * Runs `update` (which must change React state) inside a view transition when the browser has them.
 * `before` runs while the old page is still painted, `after` once the new DOM is committed.
 * Without the API (or with reduced motion) `update` just runs.
 */
export function withViewTransition(update: () => void, opts: { before?: () => void; after?: () => void; done?: () => void } = {}) {
  const start = startVT();
  if (!start || prefersReducedMotion() || document.visibilityState === 'hidden') {
    update();
    return;
  }
  try {
    opts.before?.();
    const t = start(() => {
      flushSync(update);
      opts.after?.();
    });
    const done = () => opts.done?.();
    t.finished.then(done, done);
    // an interrupted transition rejects `ready`; nothing to handle
    t.ready.catch(() => undefined);
  } catch {
    update();
    opts.done?.();
  }
}

/** Theme switch: the new theme is revealed as a circle growing from (x, y). Instant where View Transitions are missing. */
export function revealTransition(update: () => void, x: number, y: number) {
  const start = startVT();
  if (!start || prefersReducedMotion() || document.visibilityState === 'hidden') {
    update();
    return;
  }
  const root = document.documentElement;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  root.classList.add('vt-theme');
  const end = () => root.classList.remove('vt-theme');
  try {
    const t = start(() => { flushSync(update); });
    t.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 560, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => undefined);
    t.finished.then(end, end);
  } catch {
    end();
    update();
  }
}

// ---------- hooks ----------
/**
 * true for `ms` after `when(prev, next)` returned true for a change of `value`.
 * Example: a tile flashes once when a server goes online -> offline.
 */
export function useFlashOnChange<T>(value: T, when: (prev: T, next: T) => boolean, ms = 1900): boolean {
  const prev = useRef(value);
  const whenRef = useRef(when);
  whenRef.current = when;
  const [on, setOn] = useState(false);
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (Object.is(p, value)) return;
    if (!whenRef.current(p, value)) { setOn(false); return; }
    setOn(true);
    const t = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return on;
}

/**
 * Pointer depth for a hero tile: sets --px/--py (-1..1) and --hx/--hy (highlight position) on the element.
 * Spread the result on the element and give it the `depth` class; children opt in with `depth-l1` / `depth-l2`.
 * Mouse only; nothing happens for touch or reduced motion.
 */
export function useDepth<T extends HTMLElement>() {
  const onPointerMove = useCallback((e: ReactPointerEvent<T>) => {
    if (e.pointerType !== 'mouse' || prefersReducedMotion()) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    el.style.setProperty('--px', ((nx - 0.5) * 2).toFixed(3));
    el.style.setProperty('--py', ((ny - 0.5) * 2).toFixed(3));
    el.style.setProperty('--hx', `${(nx * 100).toFixed(1)}%`);
    el.style.setProperty('--hy', `${(ny * 100).toFixed(1)}%`);
    el.style.setProperty('--ho', '1');
  }, []);
  const onPointerLeave = useCallback((e: ReactPointerEvent<T>) => {
    const el = e.currentTarget;
    el.style.setProperty('--px', '0');
    el.style.setProperty('--py', '0');
    el.style.setProperty('--ho', '0');
  }, []);
  return { onPointerMove, onPointerLeave };
}

// ---------- density ----------
export type Density = 'normal' | 'compact';
const DENSITY_KEY = 'coregsm_density';
const densityListeners = new Set<(d: Density) => void>();

export const readDensity = (): Density => {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'normal';
  } catch {
    return 'normal';
  }
};

const paintDensity = (d: Density) => {
  const root = document.documentElement;
  if (d === 'compact') root.setAttribute('data-density', 'compact');
  else root.removeAttribute('data-density');
};

/** Applies the stored density to <html>; call once at start (before the first paint, from main.tsx). */
export function initDensity() {
  if (typeof document === 'undefined') return;
  paintDensity(readDensity());
}

export function setDensity(d: Density) {
  paintDensity(d);
  try {
    if (d === 'compact') localStorage.setItem(DENSITY_KEY, 'compact');
    else localStorage.removeItem(DENSITY_KEY);
  } catch {
    /* private mode: applies for this visit only */
  }
  densityListeners.forEach((l) => l(d));
}

export function useDensity(): [Density, (d: Density) => void] {
  const [d, setD] = useState<Density>(readDensity);
  useEffect(() => {
    densityListeners.add(setD);
    return () => { densityListeners.delete(setD); };
  }, []);
  return [d, setDensity];
}
