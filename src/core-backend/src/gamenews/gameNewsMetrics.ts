/**
 * The state of a game server that the plugin (0.18.11+) sends in the header `X-CoreGSM-Stats` of every poll:
 * `t=<unix s>;fps=29.8;min=24.1;worst=1200;freezes=0;mem=9810;heap=4100;players=14`
 * (frames per second on average and at the lowest, the longest frame in ms, freezes in the period, memory of the process
 * and of the game heap in MB). A point is kept once: when `t` is newer than the last one of the server. Kept for 14 days.
 */
import type { Express, RequestHandler } from 'express';
import { db } from '../db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS server_metrics (
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  fps REAL NOT NULL,
  min_fps REAL NOT NULL,
  worst_ms INTEGER NOT NULL,
  freezes INTEGER NOT NULL,
  mem_mb INTEGER NOT NULL,
  heap_mb INTEGER NOT NULL,
  players INTEGER NOT NULL,
  PRIMARY KEY (server_id, ts)
);
`);

const KEEP_MS = 14 * 86_400_000;

export interface Stats { t: number; fps: number; min: number; worst: number; freezes: number; mem: number; heap: number; players: number }

const num = (v: string | undefined, lo: number, hi: number): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

/** the header -> a point; null when it is not a state the plugin could have sent */
export function parseStats(header: string): Stats | null {
  if (!header || header.length > 300) return null;
  const kv = new Map<string, string>();
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) kv.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  const t = num(kv.get('t'), 1, 4_000_000_000);
  const fps = num(kv.get('fps'), 0, 1000);
  const min = num(kv.get('min'), 0, 1000);
  const worst = num(kv.get('worst'), 0, 3_600_000);
  const freezes = num(kv.get('freezes'), 0, 100_000);
  const mem = num(kv.get('mem'), 0, 10_000_000);
  const heap = num(kv.get('heap'), 0, 10_000_000);
  const players = num(kv.get('players'), 0, 100_000);
  if (t == null || fps == null || min == null || worst == null || freezes == null || mem == null || heap == null || players == null) return null;
  return { t: Math.round(t), fps, min, worst: Math.round(worst), freezes: Math.round(freezes), mem: Math.round(mem), heap: Math.round(heap), players: Math.round(players) };
}

/** keeps the point of a poll header (once per `t`); true when a new point was stored */
export function saveStats(serverId: number, header: string, now = Date.now()): boolean {
  const s = parseStats(header);
  if (!s) return false;
  const ts = s.t * 1000;
  // a clock that is far off is not a state of «now»
  if (ts > now + 5 * 60_000 || ts < now - 3_600_000) return false;
  const last = db.prepare('SELECT MAX(ts) AS ts FROM server_metrics WHERE server_id = ?').get(serverId) as { ts: number | null };
  if (last.ts != null && ts <= last.ts) return false;
  db.prepare('INSERT INTO server_metrics (server_id, ts, fps, min_fps, worst_ms, freezes, mem_mb, heap_mb, players) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(serverId, ts, s.fps, s.min, s.worst, s.freezes, s.mem, s.heap, s.players);
  db.prepare('DELETE FROM server_metrics WHERE server_id = ? AND ts < ?').run(serverId, now - KEEP_MS);
  return true;
}

export interface MetricPoint { ts: number; fps: number; minFps: number; worstMs: number; freezes: number; memMb: number; heapMb: number; players: number }

export function metricsOf(serverId: number, hours: number, now = Date.now()): MetricPoint[] {
  const rows = db.prepare('SELECT ts, fps, min_fps, worst_ms, freezes, mem_mb, heap_mb, players FROM server_metrics WHERE server_id = ? AND ts >= ? ORDER BY ts').all(serverId, now - hours * 3_600_000) as
    { ts: number; fps: number; min_fps: number; worst_ms: number; freezes: number; mem_mb: number; heap_mb: number; players: number }[];
  return rows.map((r) => ({ ts: r.ts, fps: r.fps, minFps: r.min_fps, worstMs: r.worst_ms, freezes: r.freezes, memMb: r.mem_mb, heapMb: r.heap_mb, players: r.players }));
}

export function registerGameNewsMetrics({ app, admin }: { app: Express; admin: RequestHandler }): void {
  // the panel: the points of a server for the charts (administrators)
  app.get('/api/game-news/metrics', admin, (req, res) => {
    const server = Number(req.query.server);
    const hours = Math.min(14 * 24, Math.max(1, Number(req.query.hours) || 24));
    if (!Number.isInteger(server) || server <= 0) return res.status(400).json({ error: 'Проверьте поля' });
    res.json({ points: metricsOf(server, hours) });
  });
}
