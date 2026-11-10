import { useSyncExternalStore } from 'react';

/** the accent colour of the Ember look (data-ember-accent on <html>): the visitor's own choice, kept in this browser */
export const EMBER_ACCENTS = ['ember', 'amber', 'coral', 'emerald'] as const;
export type EmberAccent = (typeof EMBER_ACCENTS)[number];
export const EMBER_ACCENT_KEY = 'coregsm_look_accent';
/** the colour of the swatch of each accent (the same as the brand token of the look) */
export const EMBER_ACCENT_SWATCH: Record<EmberAccent, string> = { ember: '#d6420a', amber: '#c26400', coral: '#d52850', emerald: '#047857' };

export const isEmberAccent = (v: unknown): v is EmberAccent => typeof v === 'string' && (EMBER_ACCENTS as readonly string[]).includes(v);

function read(): EmberAccent {
  try {
    const v = localStorage.getItem(EMBER_ACCENT_KEY);
    return isEmberAccent(v) ? v : 'ember';
  } catch {
    return 'ember';
  }
}

let current: EmberAccent = typeof window === 'undefined' ? 'ember' : read();
const listeners = new Set<() => void>();

function paint(a: EmberAccent) {
  if (a === 'ember') document.documentElement.removeAttribute('data-ember-accent');
  else document.documentElement.setAttribute('data-ember-accent', a);
}

/** call once before React renders */
export function initEmberAccent() {
  current = read();
  paint(current);
  window.addEventListener('storage', (e) => {
    if (e.key !== EMBER_ACCENT_KEY) return;
    current = read();
    paint(current);
    listeners.forEach((l) => l());
  });
}

export function setEmberAccent(a: EmberAccent) {
  current = a;
  try { localStorage.setItem(EMBER_ACCENT_KEY, a); } catch { /* applied for this visit only */ }
  paint(a);
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useEmberAccent(): [EmberAccent, (a: EmberAccent) => void] {
  const a = useSyncExternalStore(subscribe, () => current, () => 'ember' as EmberAccent);
  return [a, setEmberAccent];
}
