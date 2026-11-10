import { useSyncExternalStore } from 'react';

/** the last servers the visitor opened (a few names, kept in this browser): shown in the side column and in the palette */
export interface RecentServer { id: number; name: string; game: string }
const KEY = 'coregsm_recent_servers';
const MAX = 3;
const EVENT = 'coregsm:recent';

const parse = (raw: string | null): RecentServer[] => {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is RecentServer => !!x && typeof x === 'object' && Number.isInteger((x as RecentServer).id) && typeof (x as RecentServer).name === 'string' && typeof (x as RecentServer).game === 'string').slice(0, MAX);
  } catch {
    return [];
  }
};

let cache: { raw: string | null; list: RecentServer[] } = { raw: null, list: [] };
export function readRecentServers(): RecentServer[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* private mode */ }
  if (raw !== cache.raw) cache = { raw, list: parse(raw) };
  return cache.list;
}

export function rememberServer(s: RecentServer): void {
  const list = [{ id: s.id, name: s.name, game: s.game }, ...readRecentServers().filter((x) => x.id !== s.id)].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* not remembered */ }
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb); };
};
export const useRecentServers = (): RecentServer[] => useSyncExternalStore(subscribe, readRecentServers, () => []);

// ---------- the keys of the command palette («Недавние»): the last things picked or opened ----------
const PALETTE_KEY = 'coregsm_palette_recent';
export const readPaletteRecent = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(PALETTE_KEY) ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 5) : []; } catch { return []; }
};
export const rememberPaletteRecent = (key: string): void => {
  try { localStorage.setItem(PALETTE_KEY, JSON.stringify([key, ...readPaletteRecent().filter((k) => k !== key)].slice(0, 5))); } catch { /* not remembered */ }
};
