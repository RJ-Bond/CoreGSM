// Pure helpers of the server page (covered by tests): accent, event filters / day groups, player sorting, chart peak.
import { findGame } from '../../games';
import { capacityPct, slotsInfo } from '../servers/capacity';

// ---------- accent ----------
/** V Rising and Icarus bring their own accent; every other game uses the panel's brand colour */
const OWN_ACCENT = new Set(['vrising', 'icarus']);
export const BRAND_ACCENT = 'rgb(var(--brand))';
export function gameAccent(game: string): string {
  return OWN_ACCENT.has(game) ? findGame(game)?.color ?? BRAND_ACCENT : BRAND_ACCENT;
}

// ---------- events ----------
export type EventKind = 'up' | 'down' | 'peak' | 'maintenance';
export type EventFilter = 'all' | 'down' | 'up' | 'peak' | 'maintenance';
export const EVENT_FILTERS: EventFilter[] = ['all', 'down', 'up', 'peak', 'maintenance'];

export function eventCounts(events: { type: EventKind }[]): Record<EventFilter, number> {
  const c: Record<EventFilter, number> = { all: events.length, down: 0, up: 0, peak: 0, maintenance: 0 };
  for (const e of events) c[e.type] += 1;
  return c;
}

export function filterEvents<T extends { type: EventKind }>(events: T[], filter: EventFilter): T[] {
  return filter === 'all' ? events : events.filter((e) => e.type === filter);
}

const dayKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

export interface DayGroup<T> { key: string; kind: 'today' | 'yesterday' | 'date'; ts: number; items: T[] }

/** consecutive items of one calendar day (local time) form a group; the input order is kept */
export function groupByDay<T extends { ts: number }>(items: T[], now = Date.now()): DayGroup<T>[] {
  const today = dayKey(now);
  const n = new Date(now);
  const yesterday = dayKey(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime());
  const out: DayGroup<T>[] = [];
  for (const it of items) {
    const k = dayKey(it.ts);
    const last = out[out.length - 1];
    if (last && last.key === k) last.items.push(it);
    else out.push({ key: k, kind: k === today ? 'today' : k === yesterday ? 'yesterday' : 'date', ts: it.ts, items: [it] });
  }
  return out;
}

// ---------- players ----------
export type PlayerSort = 'longest' | 'newest' | 'alpha';

/** a new array: longest in the game first / latest joined first / A-Z; unknown join times go last */
export function sortPlayers<T extends { name: string; since: number | null }>(rows: T[], sort: PlayerSort): T[] {
  const alpha = (a: T, b: T) => a.name.localeCompare(b.name, 'ru');
  const r = [...rows];
  if (sort === 'alpha') return r.sort(alpha);
  return r.sort((a, b) => {
    if (a.since == null && b.since == null) return alpha(a, b);
    if (a.since == null) return 1;
    if (b.since == null) return -1;
    const d = sort === 'longest' ? a.since - b.since : b.since - a.since;
    return d || alpha(a, b);
  });
}

// ---------- chart ----------
/** the highest value of the visible series (offline samples are skipped); the latest of equal ones; null when it is 0 */
export function findPeak(points: { ts: number; players: number; online: number | boolean; ping: number | null }[], series: 'players' | 'ping'): { value: number; ts: number } | null {
  let best: { value: number; ts: number } | null = null;
  for (const p of points) {
    if (!p.online) continue;
    const v = series === 'ping' ? p.ping : p.players;
    if (v == null) continue;
    if (!best || v >= best.value) best = { value: v, ts: p.ts };
  }
  return best && best.value > 0 ? best : null;
}

/** «18:20» inside a day and a half, «13 окт., 18:20» for longer ranges */
export function peakWhen(ts: number, hours: number, locale = 'ru-RU'): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return hours <= 36 ? time : `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}, ${time}`;
}

// ---------- hero / metrics ----------
/** true when an online server has no free place */
export const isFullNow = (online: boolean, players: number, max: number) => online && slotsInfo(players, max)?.kind === 'full';

/** width (0..100) of the small static indicator of a metric */
export const metricFill = (value: number | null | undefined, max: number): number => (value == null || !(max > 0) ? 0 : capacityPct(value, max));
