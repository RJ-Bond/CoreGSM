/**
 * Data for the main page (additive, read-only):
 *   GET /api/overview?hours=24   total players over time, the peak, current totals, active / upcoming maintenance
 *   GET /api/events/recent?limit=8   the latest up / down / peak / maintenance events across all servers
 * Both are public like /api/status (the `viewer` middleware decides who may look).
 */
import type { Express, RequestHandler } from 'express';
import { db } from './db.js';
import { nextOccurrence, occurrenceAt, occurrencesBetween, type WindowRow } from './maintenance.js';

const NAME_SQL = `COALESCE(NULLIF(s.name, ''), NULLIF(st.name, ''), NULLIF(s.display_address, ''), s.host || ':' || s.port)`;
const DAY = 86_400_000;
const POINTS = 96;

export interface OverviewPoint {
  ts: number;
  players: number;
  online: number;
}

/** sums the last sample of every server in every time bucket */
export function overviewPoints(since: number, bucketMs: number): OverviewPoint[] {
  const rows = db
    .prepare(
      `SELECT b, server_id, players, online FROM (
         SELECT ts / CAST(? AS INTEGER) AS b, server_id, players, online,
                ROW_NUMBER() OVER (PARTITION BY server_id, ts / CAST(? AS INTEGER) ORDER BY ts DESC) AS rn
         FROM history WHERE ts > ?
       ) WHERE rn = 1`,
    )
    .all(bucketMs, bucketMs, since) as { b: number; server_id: number; players: number; online: number }[];
  const sums = new Map<number, OverviewPoint>();
  for (const r of rows) {
    const p = sums.get(r.b) ?? { ts: r.b * bucketMs, players: 0, online: 0 };
    if (r.online) {
      p.players += r.players;
      p.online += 1;
    }
    sums.set(r.b, p);
  }
  return [...sums.values()].sort((a, b) => a.ts - b.ts);
}

export function peakOf(points: OverviewPoint[]): { ts: number; players: number } | null {
  let best: OverviewPoint | null = null;
  for (const p of points) if (p.players > 0 && (!best || p.players >= best.players)) best = p;
  return best ? { ts: best.ts, players: best.players } : null;
}

export interface RecentEvent {
  ts: number;
  serverId: number | null;
  serverName: string | null;
  type: 'up' | 'down' | 'peak' | 'maintenance';
  players?: number;
  /** the window title (maintenance events only) */
  name?: string;
}

/** the same sources as `details.events` of a single server, taken for every server and merged */
export function recentEvents(limit: number, now = Date.now()): RecentEvent[] {
  const names = new Map<number, string>();
  for (const r of db.prepare(`SELECT s.id, ${NAME_SQL} AS n FROM servers s LEFT JOIN status st ON st.server_id = s.id`).all() as { id: number; n: string }[]) names.set(r.id, r.n);

  const out: RecentEvent[] = [];
  const week = now - 7 * DAY;
  const flips = db
    .prepare(
      `SELECT server_id, ts, online FROM (
         SELECT server_id, ts, online, LAG(online) OVER (PARTITION BY server_id ORDER BY ts) AS prev FROM history WHERE ts > ?
       ) WHERE prev IS NOT NULL AND prev <> online ORDER BY ts DESC LIMIT 300`,
    )
    .all(week) as { server_id: number; ts: number; online: number }[];
  for (const f of flips) {
    if (names.has(f.server_id)) out.push({ ts: f.ts, serverId: f.server_id, serverName: names.get(f.server_id) ?? null, type: f.online ? 'up' : 'down' });
  }
  // the busiest moment of the last 24 h of every server
  const peaks = db
    .prepare('SELECT server_id, MAX(players) AS players, ts FROM history WHERE ts > ? GROUP BY server_id HAVING MAX(players) > 0')
    .all(now - DAY) as { server_id: number; players: number; ts: number }[];
  for (const p of peaks) {
    if (names.has(p.server_id)) out.push({ ts: p.ts, serverId: p.server_id, serverName: names.get(p.server_id) ?? null, type: 'peak', players: p.players });
  }
  for (const w of db.prepare('SELECT * FROM maintenance_windows').all() as WindowRow[]) {
    if (w.server_id != null && !names.has(w.server_id)) continue;
    for (const o of occurrencesBetween(w, week, now)) {
      out.push({ ts: o.start, serverId: w.server_id, serverName: w.server_id == null ? null : names.get(w.server_id) ?? null, type: 'maintenance', name: w.name });
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, limit);
}

export interface OverviewMaintenance {
  id: number;
  serverId: number | null;
  serverName: string | null;
  name: string;
  startTs: number;
  endTs: number;
  active: boolean;
}

/** windows running now plus those starting within a week; running first, then by start */
export function maintenanceOutlook(now = Date.now()): OverviewMaintenance[] {
  const names = new Map<number, string>();
  for (const r of db.prepare(`SELECT s.id, ${NAME_SQL} AS n FROM servers s LEFT JOIN status st ON st.server_id = s.id`).all() as { id: number; n: string }[]) names.set(r.id, r.n);
  const out: OverviewMaintenance[] = [];
  for (const w of db.prepare('SELECT * FROM maintenance_windows ORDER BY id').all() as WindowRow[]) {
    if (w.server_id != null && !names.has(w.server_id)) continue;
    const cur = occurrenceAt(w, now);
    const occ = cur ?? nextOccurrence(w, now);
    if (!occ || (!cur && occ.start - now > 7 * DAY)) continue;
    out.push({ id: w.id, serverId: w.server_id, serverName: w.server_id == null ? null : names.get(w.server_id) ?? null, name: w.name, startTs: occ.start, endTs: occ.end, active: !!cur });
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || a.startTs - b.startTs).slice(0, 10);
}

export function registerOverview({ app, viewer }: { app: Express; viewer: RequestHandler }): void {
  app.get('/api/overview', viewer, (req, res) => {
    const hoursRaw = Number(req.query.hours ?? 24);
    const hours = Math.min(168, Math.max(1, Number.isFinite(hoursRaw) ? hoursRaw : 24));
    const now = Date.now();
    const bucketMs = Math.max(60_000, Math.ceil((hours * 3_600_000) / POINTS));
    const points = overviewPoints(now - hours * 3_600_000, bucketMs);
    const cur = db.prepare('SELECT COUNT(*) AS servers FROM servers').get() as { servers: number };
    const live = db
      .prepare('SELECT COUNT(*) AS online, COALESCE(SUM(players), 0) AS players FROM status WHERE online = 1 AND server_id IN (SELECT id FROM servers)')
      .get() as { online: number; players: number };
    res.json({
      hours,
      bucketMs,
      points,
      peak: peakOf(points),
      totals: { players: live.players, servers: cur.servers, online: live.online },
      maintenance: maintenanceOutlook(now),
    });
  });

  app.get('/api/events/recent', viewer, (req, res) => {
    const n = Number(req.query.limit ?? 8);
    const limit = Math.min(50, Math.max(1, Number.isFinite(n) ? Math.floor(n) : 8));
    res.json(recentEvents(limit));
  });
}
