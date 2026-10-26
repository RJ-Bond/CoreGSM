/**
 * Maintenance windows: planned work during which alerts are muted and downtime does not hurt uptime.
 * A window is [start_ts, end_ts) and may repeat every day or every week (the same length, from start_ts onwards).
 * server_id NULL = every server.
 */
import type { Express, Request, RequestHandler } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { dispatchEvent } from './alertChannels.js';

export type Repeat = 'none' | 'daily' | 'weekly';

export interface WindowRow {
  id: number;
  server_id: number | null;
  name: string;
  start_ts: number;
  end_ts: number;
  repeat: Repeat;
  created_by: string;
  created_at: number;
}

const DAY = 86_400_000;
const PERIOD: Record<Repeat, number> = { none: 0, daily: DAY, weekly: 7 * DAY };
export const MAX_WINDOW_MS = 7 * DAY;

/** the occurrence of the window that contains `ts`, or null */
export function occurrenceAt(w: Pick<WindowRow, 'start_ts' | 'end_ts' | 'repeat'>, ts: number): { start: number; end: number } | null {
  const dur = w.end_ts - w.start_ts;
  if (!(dur > 0) || ts < w.start_ts) return null;
  const p = PERIOD[w.repeat] || 0;
  if (!p) return ts < w.end_ts ? { start: w.start_ts, end: w.end_ts } : null;
  const k = Math.floor((ts - w.start_ts) / p);
  const start = w.start_ts + k * p;
  return ts < start + dur ? { start, end: start + dur } : null;
}

/** the first occurrence that has not ended before `ts` (running or upcoming), or null */
export function nextOccurrence(w: Pick<WindowRow, 'start_ts' | 'end_ts' | 'repeat'>, ts: number): { start: number; end: number } | null {
  const dur = w.end_ts - w.start_ts;
  if (!(dur > 0)) return null;
  const p = PERIOD[w.repeat] || 0;
  if (ts < w.start_ts) return { start: w.start_ts, end: w.end_ts };
  if (!p) return ts < w.end_ts ? { start: w.start_ts, end: w.end_ts } : null;
  const k = Math.floor((ts - w.start_ts) / p);
  const cur = w.start_ts + k * p;
  if (ts < cur + dur) return { start: cur, end: cur + dur };
  return { start: cur + p, end: cur + p + dur };
}

/** occurrences that start inside [from, to] (at most 200) */
export function occurrencesBetween(w: Pick<WindowRow, 'start_ts' | 'end_ts' | 'repeat'>, from: number, to: number): { start: number; end: number }[] {
  const dur = w.end_ts - w.start_ts;
  if (!(dur > 0)) return [];
  const p = PERIOD[w.repeat] || 0;
  if (!p) return w.start_ts >= from && w.start_ts <= to ? [{ start: w.start_ts, end: w.end_ts }] : [];
  const out: { start: number; end: number }[] = [];
  let k = Math.max(0, Math.ceil((from - w.start_ts) / p));
  for (; out.length < 200; k++) {
    const s = w.start_ts + k * p;
    if (s > to) break;
    out.push({ start: s, end: s + dur });
  }
  return out;
}

// ---------- state ----------
let cache: { at: number; rows: WindowRow[] } | null = null;
export const resetMaintenanceCache = () => {
  cache = null;
};
const all = (): WindowRow[] => {
  const now = Date.now();
  if (!cache || now - cache.at > 2000) cache = { at: now, rows: db.prepare('SELECT * FROM maintenance_windows ORDER BY id').all() as WindowRow[] };
  return cache.rows;
};

export interface ActiveWindow {
  id: number;
  serverId: number | null;
  name: string;
  since: number;
  until: number;
}

/** windows running at `now` (every server's included) */
export function activeWindows(now = Date.now()): ActiveWindow[] {
  const out: ActiveWindow[] = [];
  for (const w of all()) {
    const o = occurrenceAt(w, now);
    if (o) out.push({ id: w.id, serverId: w.server_id, name: w.name, since: o.start, until: o.end });
  }
  return out;
}

/** the window that currently covers the server (the one that ends last), or null: { name, until } */
export function maintenanceFor(serverId: number, now = Date.now()): { name: string; until: number } | null {
  let best: ActiveWindow | null = null;
  for (const w of activeWindows(now)) {
    if (w.serverId !== null && w.serverId !== serverId) continue;
    if (!best || w.until > best.until) best = w;
  }
  return best ? { name: best.name, until: best.until } : null;
}

export const inMaintenance = (serverId: number, now = Date.now()): boolean => maintenanceFor(serverId, now) !== null;

/** one-off windows that ended more than 30 days ago are dropped */
export function pruneMaintenance(now = Date.now()): void {
  const r = db.prepare("DELETE FROM maintenance_windows WHERE repeat = 'none' AND end_ts < ?").run(now - 30 * DAY);
  if (r.changes) resetMaintenanceCache();
}

// ---------- API ----------
const ts = z.union([z.number().int(), z.string().min(1).max(40)]).transform((v, ctx) => {
  const n = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: 'custom', message: 'Неверная дата' });
    return z.NEVER;
  }
  return Math.floor(n);
});

const bodySchema = z.object({
  serverId: z.number().int().nullable().optional(),
  name: z.string().trim().min(1, 'Укажите название').max(80),
  startTs: ts,
  endTs: ts,
  repeat: z.enum(['none', 'daily', 'weekly']).default('none'),
});

export function registerMaintenance({ app, admin, viewer }: { app: Express; admin: RequestHandler; viewer: RequestHandler }): void {
  const serialize = (w: WindowRow, now = Date.now()) => {
    const cur = occurrenceAt(w, now);
    const next = nextOccurrence(w, now);
    const server = w.server_id == null ? null : (db.prepare("SELECT COALESCE(NULLIF(name, ''), host || ':' || port) AS n FROM servers WHERE id = ?").get(w.server_id) as { n: string } | undefined)?.n ?? null;
    return {
      id: w.id,
      serverId: w.server_id,
      serverName: server,
      name: w.name,
      startTs: w.start_ts,
      endTs: w.end_ts,
      repeat: w.repeat,
      createdBy: w.created_by,
      createdAt: w.created_at,
      active: !!cur,
      until: cur ? cur.end : null,
      nextStart: next && !cur ? next.start : null,
    };
  };

  const check = (b: z.infer<typeof bodySchema>): string | null => {
    if (b.endTs <= b.startTs) return 'Окончание должно быть позже начала';
    if (b.endTs - b.startTs > MAX_WINDOW_MS) return 'Окно обслуживания не может быть длиннее 7 суток';
    if (b.repeat === 'daily' && b.endTs - b.startTs > DAY) return 'Ежедневное окно не может быть длиннее суток';
    if (b.serverId != null && !db.prepare('SELECT 1 FROM servers WHERE id = ?').get(b.serverId)) return 'Сервер не найден';
    return null;
  };
  const actor = (req: Request) => (req as Request & { user?: { username?: string } }).user?.username ?? '';

  app.get('/api/maintenance', admin, (_req, res) => {
    const now = Date.now();
    res.json(all().map((w) => serialize(w, now)));
  });

  // running right now: for the banner in the panel
  app.get('/api/maintenance/active', viewer, (_req, res) => {
    res.json(activeWindows());
  });

  app.post('/api/maintenance', admin, (req, res) => {
    const b = bodySchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля' });
    const bad = check(b.data);
    if (bad) return res.status(400).json({ error: bad });
    const info = db
      .prepare('INSERT INTO maintenance_windows (server_id, name, start_ts, end_ts, repeat, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(b.data.serverId ?? null, b.data.name, b.data.startTs, b.data.endTs, b.data.repeat, actor(req), Date.now());
    resetMaintenanceCache();
    const row = db.prepare('SELECT * FROM maintenance_windows WHERE id = ?').get(info.lastInsertRowid) as WindowRow;
    dispatchEvent({
      event: 'maintenance',
      title: `Запланировано обслуживание${row.name ? `: ${row.name}` : ''}`,
      text: `С ${new Date(row.start_ts).toISOString()} по ${new Date(row.end_ts).toISOString()} (UTC), повтор: ${row.repeat}.`,
      data: { windowId: row.id, serverId: row.server_id, name: row.name, startTs: row.start_ts, endTs: row.end_ts, repeat: row.repeat },
    });
    res.status(201).json(serialize(row));
  });

  app.put('/api/maintenance/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const b = bodySchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля' });
    const bad = check(b.data);
    if (bad) return res.status(400).json({ error: bad });
    const r = db
      .prepare('UPDATE maintenance_windows SET server_id = ?, name = ?, start_ts = ?, end_ts = ?, repeat = ? WHERE id = ?')
      .run(b.data.serverId ?? null, b.data.name, b.data.startTs, b.data.endTs, b.data.repeat, id);
    if (!r.changes) return res.status(404).json({ error: 'Окно обслуживания не найдено' });
    resetMaintenanceCache();
    res.json(serialize(db.prepare('SELECT * FROM maintenance_windows WHERE id = ?').get(id) as WindowRow));
  });

  app.delete('/api/maintenance/:id', admin, (req, res) => {
    const r = db.prepare('DELETE FROM maintenance_windows WHERE id = ?').run(Number(req.params.id));
    if (!r.changes) return res.status(404).json({ error: 'Окно обслуживания не найдено' });
    resetMaintenanceCache();
    res.json({ ok: true });
  });
}
