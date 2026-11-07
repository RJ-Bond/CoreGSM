/**
 * Automatic in-game announcements: the administrator writes a message once and a schedule (every N minutes, every day
 * at fixed times, or once) and the panel puts it into the plugin queue by itself (see gameNews.ts).
 */
import type { Express, Request, RequestHandler } from 'express';
import { z } from 'zod';
import { db, getSetting } from '../db.js';
import { log } from '../logger.js';
import { checkNews } from './gameNewsLogic.js';
import { queueNews } from './gameNews.js';
import { MAX_EVERY, MIN_EVERY, cleanTimes, dueState, inWindow, nextRunAfter, type RuleKind, type Schedule } from './gameNewsSchedule.js';

const MAX_RULES = 50;

interface RuleRow {
  id: number; name: string; text: string; server_ids: string; kind: RuleKind; every_min: number; times: string; run_at: number | null;
  active_from: number | null; active_to: number | null; only_online: number; enabled: number; last_run: number | null; next_run: number | null;
  created_by: string; created_at: number;
}

const tz = () => getSetting('timezone') || process.env.TZ || 'Europe/Moscow';
const parseArr = <T>(s: string, fallback: T[]): T[] => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : fallback; } catch { return fallback; } };
const schedOf = (r: RuleRow): Schedule => ({ kind: r.kind, everyMin: r.every_min, times: parseArr<string>(r.times, []), runAt: r.run_at });
const actor = (req: Request) => (req as Request & { user?: { username?: string } }).user?.username ?? '';

const bodySchema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(80),
  text: z.string(),
  serverIds: z.array(z.number().int().positive()).max(50),
  kind: z.enum(['interval', 'daily', 'once']),
  everyMin: z.number().int().optional(),
  times: z.array(z.string()).max(12).optional(),
  runAt: z.number().int().nullable().optional(),
  activeFrom: z.number().int().nullable().optional(),
  activeTo: z.number().int().nullable().optional(),
  onlyOnline: z.boolean(),
  enabled: z.boolean(),
});

/** what is wrong with the body, or null; also returns the cleaned values */
function check(b: z.infer<typeof bodySchema>, now: number): { error: string } | { text: string; sched: Schedule } {
  const chk = checkNews(b.text);
  if (!chk.ok) return { error: chk.error ?? 'Проверьте текст' };
  if (b.serverIds.length && b.serverIds.some((id) => !db.prepare('SELECT 1 FROM servers WHERE id = ?').get(id))) return { error: 'Сервер не найден' };
  if (b.activeFrom != null && b.activeTo != null && b.activeTo < b.activeFrom) return { error: 'Конец периода раньше начала' };
  const sched: Schedule = { kind: b.kind, everyMin: b.everyMin ?? 0, times: cleanTimes(b.times ?? []), runAt: b.runAt ?? null };
  if (b.kind === 'interval' && (sched.everyMin < MIN_EVERY || sched.everyMin > MAX_EVERY)) return { error: `Интервал: от ${MIN_EVERY} минут до недели` };
  if (b.kind === 'daily' && !sched.times.length) return { error: 'Укажите хотя бы одно время (ЧЧ:ММ)' };
  if (b.kind === 'once' && (sched.runAt == null || sched.runAt <= now)) return { error: 'Время отправки должно быть в будущем' };
  return { text: chk.text, sched };
}

/** one scheduler pass: sends what is due, moves next_run on */
export function tickRules(now = Date.now()): number {
  const rows = db.prepare('SELECT * FROM game_news_rules WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?').all(now) as RuleRow[];
  let sent = 0;
  const zone = tz();
  for (const r of rows) {
    const due = dueState(r.next_run, now);
    const next = nextRunAfter(schedOf(r), now, zone);
    if (due === 'fire' && inWindow(now, r.active_from, r.active_to)) {
      const res = queueNews(r.text, parseArr<number>(r.server_ids, []), `авто: ${r.name}`, now, { onlyOnline: !!r.only_online });
      sent += res.filter((x) => x.queued).length;
      db.prepare('UPDATE game_news_rules SET last_run = ? WHERE id = ?').run(now, r.id);
    }
    // a once rule ends after its run (or after it was missed); the others go on
    if (next == null) db.prepare('UPDATE game_news_rules SET next_run = NULL, enabled = 0 WHERE id = ?').run(r.id);
    else db.prepare('UPDATE game_news_rules SET next_run = ? WHERE id = ?').run(next, r.id);
  }
  return sent;
}

let timer: NodeJS.Timeout | undefined;
let busy = false;
export function startGameNewsTimer(): void {
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    try { tickRules(); } catch (e) { log.error('game news scheduler failed', (e as Error).message); } finally { busy = false; }
  }, 20_000);
  timer.unref();
}
export const stopGameNewsTimer = () => clearInterval(timer);

export function registerGameNewsRules({ app, admin }: { app: Express; admin: RequestHandler }): void {
  const serialize = (r: RuleRow) => ({
    id: r.id, name: r.name, text: r.text, serverIds: parseArr<number>(r.server_ids, []), kind: r.kind, everyMin: r.every_min,
    times: parseArr<string>(r.times, []), runAt: r.run_at, activeFrom: r.active_from, activeTo: r.active_to, onlyOnline: !!r.only_online,
    enabled: !!r.enabled, lastRun: r.last_run, nextRun: r.enabled ? r.next_run : null, createdBy: r.created_by,
  });

  app.get('/api/game-news/rules', admin, (_req, res) => {
    const rows = db.prepare('SELECT * FROM game_news_rules ORDER BY id').all() as RuleRow[];
    res.json({ timezone: tz(), rules: rows.map(serialize) });
  });

  app.post('/api/game-news/rules', admin, (req, res) => {
    const b = bodySchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля' });
    const now = Date.now();
    if ((db.prepare('SELECT COUNT(*) AS n FROM game_news_rules').get() as { n: number }).n >= MAX_RULES) return res.status(400).json({ error: `Не больше ${MAX_RULES} автообъявлений` });
    const c = check(b.data, now);
    if ('error' in c) return res.status(400).json({ error: c.error });
    const next = b.data.enabled ? nextRunAfter(c.sched, now, tz()) : null;
    const info = db.prepare(
      `INSERT INTO game_news_rules (name, text, server_ids, kind, every_min, times, run_at, active_from, active_to, only_online, enabled, next_run, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(b.data.name, c.text, JSON.stringify(b.data.serverIds), b.data.kind, c.sched.everyMin, JSON.stringify(c.sched.times), c.sched.runAt,
      b.data.activeFrom ?? null, b.data.activeTo ?? null, b.data.onlyOnline ? 1 : 0, b.data.enabled ? 1 : 0, next, actor(req), now);
    res.json({ id: Number(info.lastInsertRowid) });
  });

  app.put('/api/game-news/rules/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const old = db.prepare('SELECT * FROM game_news_rules WHERE id = ?').get(id) as RuleRow | undefined;
    if (!old) return res.status(404).json({ error: 'Автообъявление не найдено' });
    const b = bodySchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля' });
    const now = Date.now();
    const c = check(b.data, now);
    if ('error' in c) return res.status(400).json({ error: c.error });
    // the schedule restarts from now whenever it (or the on/off switch) changes
    const scheduleChanged = old.kind !== b.data.kind || old.every_min !== c.sched.everyMin || old.times !== JSON.stringify(c.sched.times) || old.run_at !== c.sched.runAt || !!old.enabled !== b.data.enabled;
    const next = !b.data.enabled ? null : scheduleChanged || old.next_run == null ? nextRunAfter(c.sched, now, tz()) : old.next_run;
    db.prepare(
      `UPDATE game_news_rules SET name = ?, text = ?, server_ids = ?, kind = ?, every_min = ?, times = ?, run_at = ?, active_from = ?, active_to = ?,
       only_online = ?, enabled = ?, next_run = ? WHERE id = ?`,
    ).run(b.data.name, c.text, JSON.stringify(b.data.serverIds), b.data.kind, c.sched.everyMin, JSON.stringify(c.sched.times), c.sched.runAt,
      b.data.activeFrom ?? null, b.data.activeTo ?? null, b.data.onlyOnline ? 1 : 0, b.data.enabled ? 1 : 0, next, id);
    res.json({ ok: true });
  });

  app.delete('/api/game-news/rules/:id', admin, (req, res) => {
    db.prepare('DELETE FROM game_news_rules WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // «Отправить сейчас»: the same message right away, outside the schedule
  app.post('/api/game-news/rules/:id/run', admin, (req, res) => {
    const r = db.prepare('SELECT * FROM game_news_rules WHERE id = ?').get(Number(req.params.id)) as RuleRow | undefined;
    if (!r) return res.status(404).json({ error: 'Автообъявление не найдено' });
    const now = Date.now();
    const results = queueNews(r.text, parseArr<number>(r.server_ids, []), `авто: ${r.name}`, now);
    db.prepare('UPDATE game_news_rules SET last_run = ? WHERE id = ?').run(now, r.id);
    res.json({ results });
  });
}
