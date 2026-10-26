import { useSyncExternalStore } from 'react';

/**
 * Accessibility appearance options, kept in this browser only (localStorage) and applied to <html> before the first paint:
 *   reduceMotion  -> data-motion="reduce"   (CSS switches animations and transitions off; without it the OS setting rules)
 *   largeText     -> data-text="large"      (root font scale 112.5 %)
 *   highContrast  -> data-contrast="high"   (stronger ink and borders)
 *   liteData      -> data-lite="1"          (data saving: no decorations or animations, polling twice as rare);
 *                    also on by itself when the browser asks for it (Save-Data, a 2G connection)
 */
export interface Appearance {
  reduceMotion: boolean;
  largeText: boolean;
  highContrast: boolean;
  liteData: boolean;
}

export const APPEARANCE_KEY = 'coregsm_appearance';
export const DEFAULT_APPEARANCE: Appearance = { reduceMotion: false, largeText: false, highContrast: false, liteData: false };

/** anything (a stored string, a broken value) -> a complete Appearance */
export function normalizeAppearance(raw: unknown): Appearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { reduceMotion: r.reduceMotion === true, largeText: r.largeText === true, highContrast: r.highContrast === true, liteData: r.liteData === true };
}

function read(): Appearance {
  try {
    const s = localStorage.getItem(APPEARANCE_KEY);
    return s ? normalizeAppearance(JSON.parse(s)) : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** the browser or the network asks to spare the traffic */
export function networkWantsLite(): boolean {
  const c = (typeof navigator !== 'undefined' ? (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection : undefined);
  return !!c && (c.saveData === true || c.effectiveType === 'slow-2g' || c.effectiveType === '2g');
}

/** writes the attributes: an option that is off removes its attribute, so the CSS defaults apply */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement) {
  const set = (name: string, value: string | null) => {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  };
  set('data-motion', a.reduceMotion ? 'reduce' : null);
  set('data-text', a.largeText ? 'large' : null);
  set('data-contrast', a.highContrast ? 'high' : null);
  set('data-lite', a.liteData || networkWantsLite() ? '1' : null);
}

let current: Appearance = typeof window === 'undefined' ? DEFAULT_APPEARANCE : read();
const listeners = new Set<() => void>();

export const getAppearance = () => current;

export function setAppearance(patch: Partial<Appearance>) {
  const next = normalizeAppearance({ ...current, ...patch });
  if (next.reduceMotion === current.reduceMotion && next.largeText === current.largeText && next.highContrast === current.highContrast && next.liteData === current.liteData) return;
  current = next;
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
  } catch {
    /* private mode: applied for this visit only */
  }
  applyAppearance(next);
  listeners.forEach((l) => l());
}

/** call once before React renders: paints the saved options and follows changes made in another tab */
export function initAppearance() {
  current = read();
  applyAppearance(current);
  window.addEventListener('storage', (e) => {
    if (e.key !== APPEARANCE_KEY) return;
    current = read();
    applyAppearance(current);
    listeners.forEach((l) => l());
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export function useAppearance(): [Appearance, (patch: Partial<Appearance>) => void] {
  const a = useSyncExternalStore(subscribe, getAppearance, getAppearance);
  return [a, setAppearance];
}
