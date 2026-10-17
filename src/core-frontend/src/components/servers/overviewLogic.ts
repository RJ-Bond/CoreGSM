// Pure logic of the main page: the hero pick, the state of the pulse strip. Covered by tests.
import type { Server } from '../../api';
import { LAG_PING } from '../../ui';

export type HeroReason = 'attention' | 'maintenance' | 'fav' | 'busiest' | null;

/** a server that needs a look: not answering (after a first answer) or slow, outside a maintenance window */
export const needsAttention = (s: Server): boolean => !s.maintenance && s.hasStatus && (!s.online || (s.ping != null && s.ping > LAG_PING));

export function pickHero(servers: Server[], favs: number[]): { server: Server; reason: HeroReason } | null {
  if (servers.length === 0) return null;
  const withReason = (server: Server, reason: HeroReason) => ({ server, reason: server.maintenance && reason !== 'attention' ? ('maintenance' as const) : reason });
  // Servers that need a look are not the hero: they get a compact strip (AttentionStrip) so that the working ones keep
  // the first screen. Only when every server has a problem is the worst one the hero (a card with the details).
  const calm = servers.filter((s) => !needsAttention(s));
  if (calm.length === 0) {
    const bad = [...servers].sort((a, b) => Number(a.online) - Number(b.online) || b.players - a.players || a.id - b.id);
    return { server: bad[0], reason: 'attention' };
  }
  servers = calm;
  const fav = servers.filter((s) => favs.includes(s.id)).sort((a, b) => Number(b.online) - Number(a.online) || b.players - a.players || a.id - b.id);
  if (fav[0]) return withReason(fav[0], 'fav');
  const busiest = servers.filter((s) => s.online).sort((a, b) => b.players - a.players || a.id - b.id);
  if (busiest[0]) return withReason(busiest[0], 'busiest');
  return withReason(servers[0], null);
}

export type PulseState = 'ok' | 'warn' | 'bad' | 'maint' | 'wait';

export function pulseOf(servers: Server[]): { state: PulseState; problems: Server[] } {
  const problems = servers.filter(needsAttention);
  if (problems.some((s) => !s.online)) return { state: 'bad', problems };
  if (problems.length) return { state: 'warn', problems };
  if (servers.some((s) => s.maintenance)) return { state: 'maint', problems };
  if (servers.length > 0 && servers.every((s) => !s.hasStatus)) return { state: 'wait', problems };
  return { state: 'ok', problems };
}

export interface OverviewData {
  hours: number;
  bucketMs: number;
  points: { ts: number; players: number; online: number }[];
  peak: { ts: number; players: number } | null;
  totals: { players: number; servers: number; online: number };
  maintenance: { id: number; serverId: number | null; serverName: string | null; name: string; startTs: number; endTs: number; active: boolean }[];
}

export interface RecentEvent {
  ts: number;
  serverId: number | null;
  serverName: string | null;
  type: 'up' | 'down' | 'peak' | 'maintenance';
  players?: number;
  name?: string;
}

/** Enough history to draw a curve: at least 3 points (buckets), i.e. about half an hour of polls. */
export const hasEnoughHistory = (points: { ts: number }[]): boolean => points.length >= 3;

/**
 * Where the chart starts: the beginning of the window, but not earlier than the first sample. A young panel (a few
 * hours of history) then fills the whole chart instead of being squeezed against the right edge of an empty 24 h.
 */
export function chartStart(points: { ts: number }[], bucketMs: number, end: number, hours: number): number {
  const windowStart = end - hours * 3_600_000;
  return points.length ? Math.max(windowStart, points[0].ts - bucketMs) : windowStart;
}

/** x/y positions (0..1, y up = more players) of the chart points for a window ending at `end` */
export function chartPoints(points: { ts: number; players: number }[], start: number, end: number): { x: number; y: number }[] {
  const max = Math.max(1, ...points.map((p) => p.players));
  const span = Math.max(1, end - start);
  return points.map((p) => ({ x: Math.max(0, Math.min(1, (p.ts - start) / span)), y: p.players / max }));
}
