import { useEffect, useState } from 'react';
import { api, type Server } from './api';
import { WHITE, brandVars, parseTriplet, triplet, type RGB } from './colors';
import { gameColor, findGame } from './games';

/**
 * «Акцент по игре»: the colour family of the whole panel (--brand, --brand-2, --brand-hover, --link) can follow a game.
 *   brand   - the community colour from the branding settings (default, no change)
 *   vrising / icarus - always that game's accent
 *   auto    - the game of the open server page, otherwise the game most of the servers belong to (only games that have
 *             an accent: V Rising, Icarus); with no such game the community colour stays
 * Contrast is guaranteed by brandVars (white on fills >= 4.5:1, brand text >= 4.5:1 on card, soft and raised surfaces).
 * The choice is remembered per browser (localStorage, wrapped in try/catch).
 */
export type AccentMode = 'auto' | 'vrising' | 'icarus' | 'brand';
export const ACCENT_MODES: { id: AccentMode; label: string; hint: string }[] = [
  { id: 'auto', label: 'Авто', hint: 'Цвет игры открытого сервера или основной игры сообщества' },
  { id: 'vrising', label: 'V Rising', hint: 'Всегда фиолетовый акцент V Rising' },
  { id: 'icarus', label: 'Icarus', hint: 'Всегда янтарный акцент Icarus' },
  { id: 'brand', label: 'По бренду', hint: 'Цвет сообщества из раздела «Оформление»' },
];
/** games that have an accent of their own */
const ACCENT_GAMES: readonly string[] = ['vrising', 'icarus'];

const KEY = 'coregsm_accent';
const MODES: AccentMode[] = ['auto', 'vrising', 'icarus', 'brand'];

export const readAccentMode = (): AccentMode => {
  try {
    const v = localStorage.getItem(KEY) as AccentMode | null;
    return v && MODES.includes(v) ? v : 'brand';
  } catch {
    return 'brand';
  }
};

let mode: AccentMode = typeof window === 'undefined' ? 'brand' : readAccentMode();
/** the accent game resolved from the route / the server list while mode is 'auto' */
let autoGame: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setAccentMode(m: AccentMode) {
  mode = m;
  try {
    if (m === 'brand') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, m);
  } catch {
    /* private mode: applies for this visit only */
  }
  emit();
}

/** hex colour of the accent that is in force, or null when the community colour applies */
export function accentColor(): string | null {
  if (mode === 'brand') return null;
  const g = mode === 'auto' ? autoGame : mode;
  return g && findGame(g) ? gameColor(g) : null;
}

const isDark = (root: HTMLElement) => {
  const a = root.getAttribute('data-theme');
  return a === 'dark' || (!a && window.matchMedia('(prefers-color-scheme: dark)').matches);
};

/**
 * Writes --brand / --brand-hover / --brand-2 / --link for the community colours, replaced by the accent when one is in force.
 * Used by useBrand (App.tsx) and by the live preview in Settings so they never fight each other.
 */
export function paintBrand(color: string, color2?: string) {
  const root = document.documentElement;
  const dark = isDark(root);
  const st = getComputedStyle(root);
  const surf = (n: string, f: RGB) => parseTriplet(st.getPropertyValue(`--${n}`)) ?? f;
  const card = surf('card', dark ? [18, 20, 27] : WHITE);
  const soft = surf('soft', dark ? [30, 33, 44] : [236, 238, 246]);
  const raised = surf('raised', card);
  // brand text must read on the lightest of the surfaces it can sit on
  const lum = (c: RGB) => c[0] + c[1] + c[2];
  const lightest = lum(raised) > lum(soft) ? raised : soft;
  const accent = accentColor();
  const v = brandVars(accent ?? color, accent ? undefined : color2, dark, card, lightest);
  root.style.setProperty('--brand', triplet(v.fill));
  root.style.setProperty('--brand-hover', triplet(v.hover));
  root.style.setProperty('--brand-2', triplet(v.end));
  root.style.setProperty('--link', triplet(v.link));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', accent ?? color);
}

/** subscribes to accent changes (mode or the auto game); `fn` should repaint the brand */
export function onAccentChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useAccentMode(): [AccentMode, (m: AccentMode) => void] {
  const [m, setM] = useState<AccentMode>(mode);
  useEffect(() => onAccentChange(() => setM(mode)), []);
  return [m, setAccentMode];
}

/**
 * Keeps the 'auto' game up to date: call once from App when the shell is shown. Fetches the server list once (only in
 * auto mode) and follows the route #/servers/<id>. Does nothing in the other modes.
 */
export function useAutoAccent(active: boolean, route: { page: string; sub: string }) {
  const [m] = useAccentMode();
  const [servers, setServers] = useState<Pick<Server, 'id' | 'game'>[]>([]);
  useEffect(() => {
    if (!active || m !== 'auto') return;
    let alive = true;
    api<Server[]>('/servers').then((s) => { if (alive) setServers(s.map((x) => ({ id: x.id, game: x.game }))); }).catch(() => undefined);
    return () => { alive = false; };
  }, [active, m]);
  useEffect(() => {
    let g: string | null = null;
    if (m === 'auto') {
      const id = route.page === 'servers' ? Number(route.sub.split('/')[0]) : NaN;
      const here = Number.isFinite(id) ? servers.find((s) => s.id === id)?.game : undefined;
      if (here && ACCENT_GAMES.includes(here)) g = here;
      else {
        const count = new Map<string, number>();
        servers.forEach((s) => count.set(s.game, (count.get(s.game) ?? 0) + 1));
        const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
        if (top && ACCENT_GAMES.includes(top[0])) g = top[0];
      }
    }
    if (g !== autoGame) { autoGame = g; emit(); }
  }, [m, route.page, route.sub, servers]);
}
