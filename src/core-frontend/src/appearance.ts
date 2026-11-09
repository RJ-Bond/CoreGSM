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
  /** pure black page and darker cards in the dark theme (saves an OLED screen, rests the eyes at night) */
  oled: boolean;
  /** the «Ember» look: graphite and an orange accent, firmer shapes (data-ember) */
  ember: boolean;
}

/** presets: a few options at once; the ones not named are switched off */
export type PresetId = 'classic' | 'ember' | 'contrast' | 'soft' | 'oled';
export const PRESETS: Record<PresetId, Appearance> = {
  classic: { reduceMotion: false, largeText: false, highContrast: false, liteData: false, oled: false, ember: false },
  ember: { reduceMotion: false, largeText: false, highContrast: false, liteData: false, oled: false, ember: true },
  contrast: { reduceMotion: false, largeText: true, highContrast: true, liteData: false, oled: false, ember: false },
  soft: { reduceMotion: true, largeText: false, highContrast: false, liteData: true, oled: false, ember: false },
  oled: { reduceMotion: false, largeText: false, highContrast: false, liteData: false, oled: true, ember: false },
};
export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];
/** the preset the options match exactly, or null (a custom mix) */
export function presetOf(a: Appearance): PresetId | null {
  return PRESET_IDS.find((id) => (Object.keys(PRESETS[id]) as (keyof Appearance)[]).every((k) => PRESETS[id][k] === a[k])) ?? null;
}

export const APPEARANCE_KEY = 'coregsm_appearance';
export const DEFAULT_APPEARANCE: Appearance = { reduceMotion: false, largeText: false, highContrast: false, liteData: false, oled: false, ember: false };

/** anything (a stored string, a broken value) -> a complete Appearance */
export function normalizeAppearance(raw: unknown): Appearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { reduceMotion: r.reduceMotion === true, largeText: r.largeText === true, highContrast: r.highContrast === true, liteData: r.liteData === true, oled: r.oled === true, ember: r.ember === true };
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
  set('data-oled', a.oled ? '1' : null);
  set('data-ember', a.ember ? '1' : null);
}

let current: Appearance = typeof window === 'undefined' ? DEFAULT_APPEARANCE : read();
const listeners = new Set<() => void>();

export const getAppearance = () => current;

export function setAppearance(patch: Partial<Appearance>) {
  const next = normalizeAppearance({ ...current, ...patch });
  if (next.reduceMotion === current.reduceMotion && next.largeText === current.largeText && next.highContrast === current.highContrast && next.liteData === current.liteData && next.oled === current.oled && next.ember === current.ember) return;
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
