/**
 * Planned restarts through the game plugin: «every day at 05:00» (or on chosen days). A schedule does not restart anything by
 * itself: `warnSec` before the time it starts the usual restart timer (the chat counts down, then the plugin closes the server),
 * so the players are warned exactly as for a restart that an administrator started by hand.
 *
 * Not to be mixed with the restart plans of monitoring/restarts.ts (those restart through RCON and have their own warning):
 * this one needs the game plugin and is for servers without RCON.
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { log } from '../logger.js';
import { startRestart } from './gameNewsServerRestart.js';
import { isHHMM, nextRunAfter } from './gameNewsSchedule.js';
import { panelTz, serverLabel } from './gameNewsVars.js';

export interface ScheduleRow {
  id: number;
  server_id: number;
  time: string;
  days: string;
  warn_sec: number;
  enabled: number;
  skip_r: number;
  fired_r: number;
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** the day of the week (0 = Sunday) of a moment in a time zone */
export function weekdayOf(ts: number, tz: string): number {
  let name: string;
  try {
    name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(ts));
  } catch {
    name = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(ts));
  }
  return Math.max(0, DAY.indexOf(name));
}

const parseDays = (s: string): number[] => {
  try { return (JSON.parse(s) as unknown[]).filter((x): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 6); } catch { return []; }
};

/** the next moment of the restart (not of the warning) on an allowed day, after `after`; null when there is none */
export function nextRestartAt(time: string, days: number[], after: number, tz: string): number | null {
  let t: number | null = after;
  for (let i = 0; i < 9 && t != null; i++) {
    t = nextRunAfter({ kind: 'daily', everyMin: 0, times: [time], runAt: null }, t, tz);
    if (t != null && (days.length === 0 || days.includes(weekdayOf(t, tz)))) return t;
  }
  return null;
}

/** one pass: a schedule whose warning moment has come starts the timer (once per restart moment) */
export function tickRestartSchedule(now = Date.now()): void {
  const tz = panelTz();
  const rows = db.prepare('SELECT * FROM game_restart_schedule WHERE enabled = 1').all() as ScheduleRow[];
  for (const r of rows) {
    const at = nextRestartAt(r.time, parseDays(r.days), now - 1000, tz);
    if (at == null || at === r.fired_r || at === r.skip_r) continue;
    const left = Math.ceil((at - now) / 1000);
    if (left <= 0 || left > r.warn_sec) continue;
    db.prepare('UPDATE game_restart_schedule SET fired_r = ? WHERE id = ?').run(at, r.id);
    const ids = r.server_id
      ? [r.server_id]
      : (db.prepare("SELECT server_id FROM game_news_targets WHERE token_hash <> ''").all() as { server_id: number }[]).map((x) => x.server_id);
    for (const id of ids) {
      try { startRestart(id, Math.max(10, left), 'расписание', 'расписание', now); } catch (e) { log.error('game restart schedule failed', (e as Error).message); }
    }
  }
}

const bodySchema = z.object({
  serverId: z.number().int().min(0),
  time: z.string().refine(isHHMM, 'time'),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  warnSec: z.number().int().min(60).max(3600),
  enabled: z.boolean(),
});

export function registerGameNewsRestartSchedule({ app, admin }: { app: Express; admin: RequestHandler }): void {
  const view = (r: ScheduleRow, now: number) => {
    const days = parseDays(r.days);
    const next = nextRestartAt(r.time, days, now, panelTz());
    return {
      id: r.id, serverId: r.server_id, serverName: r.server_id ? serverLabel(r.server_id) : '', time: r.time, days, warnSec: r.warn_sec,
      enabled: !!r.enabled, next, skipped: next != null && next === r.skip_r,
    };
  };

  app.get('/api/game-news/restart-schedule', admin, (_req, res) => {
    const now = Date.now();
    const rows = db.prepare('SELECT * FROM game_restart_schedule ORDER BY time, id').all() as ScheduleRow[];
    res.json({ items: rows.map((r) => view(r, now)), timezone: panelTz() });
  });

  const check = (serverId: number): boolean => serverId === 0 || !!db.prepare("SELECT 1 FROM game_news_targets WHERE server_id = ? AND token_hash <> ''").get(serverId);

  app.post('/api/game-news/restart-schedule', admin, (req, res) => {
    const b = bodySchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    if (!check(b.data.serverId)) return res.status(400).json({ error: 'Выберите сервер с плагином' });
    if ((db.prepare('SELECT COUNT(*) AS n FROM game_restart_schedule').get() as { n: number }).n >= 20) return res.status(400).json({ error: 'Не больше 20 расписаний' });
    const info = db.prepare('INSERT INTO game_restart_schedule (server_id, time, days, warn_sec, enabled) VALUES (?, ?, ?, ?, ?)')
      .run(b.data.serverId, b.data.time, JSON.stringify([...new Set(b.data.days)].sort()), b.data.warnSec, b.data.enabled ? 1 : 0);
    res.json({ id: Number(info.lastInsertRowid) });
  });

  app.put('/api/game-news/restart-schedule/:id', admin, (req, res) => {
    const b = bodySchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    if (!check(b.data.serverId)) return res.status(400).json({ error: 'Выберите сервер с плагином' });
    const info = db.prepare('UPDATE game_restart_schedule SET server_id = ?, time = ?, days = ?, warn_sec = ?, enabled = ?, skip_r = 0 WHERE id = ?')
      .run(b.data.serverId, b.data.time, JSON.stringify([...new Set(b.data.days)].sort()), b.data.warnSec, b.data.enabled ? 1 : 0, Number(req.params.id));
    if (!info.changes) return res.status(404).json({ error: 'Расписание не найдено' });
    res.json({ ok: true });
  });

  app.delete('/api/game-news/restart-schedule/:id', admin, (req, res) => {
    db.prepare('DELETE FROM game_restart_schedule WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // «пропустить ближайший»: this one restart does not happen, the next ones do
  app.post('/api/game-news/restart-schedule/:id/skip', admin, (req, res) => {
    const r = db.prepare('SELECT * FROM game_restart_schedule WHERE id = ?').get(Number(req.params.id)) as ScheduleRow | undefined;
    if (!r) return res.status(404).json({ error: 'Расписание не найдено' });
    const now = Date.now();
    const next = nextRestartAt(r.time, parseDays(r.days), now, panelTz());
    const skip = z.object({ skip: z.boolean() }).safeParse(req.body);
    const on = skip.success ? skip.data.skip : true;
    db.prepare('UPDATE game_restart_schedule SET skip_r = ? WHERE id = ?').run(on && next ? next : 0, r.id);
    res.json({ ok: true });
  });
}

let timer: NodeJS.Timeout | undefined;
export function startRestartScheduleTimer(): void {
  timer = setInterval(() => {
    try { tickRestartSchedule(); } catch (e) { log.error('game restart schedule timer failed', (e as Error).message); }
  }, 15_000);
  timer.unref();
}
export const stopRestartScheduleTimer = () => clearInterval(timer);
