import type { Server } from '../../api';
import { needsAttention, pickHero, type HeroReason } from './overviewLogic';

/** the usual number of players at an hour of the week: 7 x 24 values, UTC, Sunday first (as the baseline of the server page) */
export const usualAtHour = (baseline: (number | null)[], ts: number): number | null => {
  const d = new Date(ts);
  return baseline[d.getUTCDay() * 24 + d.getUTCHours()] ?? null;
};

export interface UsualPeak {
  /** the start of the busiest hour among the next twelve (this hour included) */
  at: number;
  /** whole hours from now: 0 = it is the hour of the peak now */
  hoursAhead: number;
  value: number;
  /** the current hour is already as busy as the peak (or nearly) */
  now: boolean;
}

/**
 * When the server is usually the busiest in the next twelve hours, by its baseline of the week.
 * null when the baseline is flat or too small to say anything (a young server, an empty one).
 */
export function nextUsualPeak(baseline: (number | null)[] | null | undefined, nowTs: number, horizon = 12): UsualPeak | null {
  if (!baseline || baseline.length < 168) return null;
  const hour = Math.floor(nowTs / 3_600_000) * 3_600_000;
  let best: { i: number; v: number } | null = null;
  let low = Infinity;
  for (let i = 0; i < horizon; i++) {
    const v = usualAtHour(baseline, hour + i * 3_600_000);
    if (v == null) continue;
    low = Math.min(low, v);
    if (!best || v > best.v) best = { i, v };
  }
  if (!best || best.v < 2 || best.v - low < Math.max(1, best.v * 0.15)) return null;
  const cur = usualAtHour(baseline, hour);
  return { at: hour + best.i * 3_600_000, hoursAhead: best.i, value: Math.round(best.v), now: best.i === 0 || (cur != null && cur >= best.v * 0.92) };
}

export type HeroMode = 'busiest' | 'fullest' | 'favourite';
export const HERO_MODES: HeroMode[] = ['busiest', 'fullest', 'favourite'];
const MODE_KEY = 'coregsm_hero_mode';
export const isHeroMode = (v: unknown): v is HeroMode => v === 'busiest' || v === 'fullest' || v === 'favourite';
export function readHeroMode(): HeroMode {
  try { const v = localStorage.getItem(MODE_KEY); return isHeroMode(v) ? v : 'busiest'; } catch { return 'busiest'; }
}
export function saveHeroMode(m: HeroMode): void {
  try { localStorage.setItem(MODE_KEY, m); } catch { /* not remembered */ }
}

/**
 * The server of the big card. A server that needs a look still comes first when every server has a problem (pickHero);
 * otherwise «busiest» is the old choice (the busiest favourite, else the busiest server), «fullest» is the one whose
 * places are taken the most, «favourite» is the favourite that has the most players (none: the old choice).
 */
export function pickHeroBy(servers: Server[], favs: number[], mode: HeroMode): { server: Server; reason: HeroReason } | null {
  const base = pickHero(servers, favs);
  if (!base || base.reason === 'attention' || mode === 'busiest') return base;
  const calm = servers.filter((s) => !needsAttention(s) && s.online);
  if (mode === 'fullest') {
    const full = calm.filter((s) => s.maxPlayers > 0).sort((a, b) => b.players / b.maxPlayers - a.players / a.maxPlayers || b.players - a.players || a.id - b.id)[0];
    return full ? { server: full, reason: 'busiest' } : base;
  }
  const fav = calm.filter((s) => favs.includes(s.id)).sort((a, b) => b.players - a.players || a.id - b.id)[0];
  return fav ? { server: fav, reason: 'fav' } : base;
}
