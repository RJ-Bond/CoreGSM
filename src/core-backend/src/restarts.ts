/**
 * Scheduled restarts of a game server.
 *
 * The admin picks the days and the time (the panel suggests the quietest hour from the analytics). Before the
 * restart the panel warns the players: a message in Discord and, when RCON is set up, in the game chat. At the
 * time it opens a maintenance window (the restart does not count as an outage), sends the restart command over
 * RCON, if one is set, and reports how it went.
 *
 *   GET  /api/servers/:id/restart        the plan, the next run, the suggested hour, the RCON settings (no password)
 *   PUT  /api/servers/:id/restart        save the plan (permission «Обслуживание»)
 *   PUT  /api/servers/:id/rcon           RCON port and password (administrators)
 *   POST /api/servers/:id/rcon/test      run a command now and show the answer (administrators)
 *   POST /api/servers/:id/restart/now    restart now, without the warning (permission «Обслуживание»)
 */
import express from 'express';
import { z } from 'zod';
import { admin, allow, type AuthedRequest } from './auth.js';
import { enqueueAlert } from './alerts.js';
import { db, EFFECTIVE_NAME, getSetting } from './db.js';
import { defaultSay, nextRun } from './restartLogic.js';
import { rconCommand } from './rcon.js';
import { decryptSecret, encryptSecret } from './secrets.js';
import { analyticsFor } from './routes/analytics.js';

export const router = express.Router();

db.exec(`
CREATE TABLE IF NOT EXISTS restart_plans (
  server_id INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  days INTEGER NOT NULL DEFAULT 127,
  at_min INTEGER NOT NULL DEFAULT 360,
  duration_min INTEGER NOT NULL DEFAULT 10,
  warn_min INTEGER NOT NULL DEFAULT 10,
  channel_id TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL DEFAULT '',
  say TEXT NOT NULL DEFAULT '',
  warned_for INTEGER NOT NULL DEFAULT 0,
  ran_for INTEGER NOT NULL DEFAULT 0,
  last_result TEXT,
  last_run_at INTEGER
);
CREATE TABLE IF NOT EXISTS server_rcon (
  server_id INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  port INTEGER NOT NULL,
  password TEXT NOT NULL
);
`);

export interface Plan {
  server_id: number;
  enabled: number;
  /** bit 0 = Monday ... bit 6 = Sunday */
  days: number;
  at_min: number;
  duration_min: number;
  warn_min: number;
  channel_id: string;
  command: string;
  /** the in-game message command, {text} is replaced by the warning */
  say: string;
  warned_for: number;
  ran_for: number;
  last_result: string | null;
  last_run_at: number | null;
}

const tz = () => getSetting('timezone') || process.env.TZ || 'Europe/Moscow';
const DEFAULT_PLAN = (serverId: number): Plan => ({ server_id: serverId, enabled: 0, days: 127, at_min: 360, duration_min: 10, warn_min: 10, channel_id: '', command: '', say: '', warned_for: 0, ran_for: 0, last_result: null, last_run_at: null });
const planOf = (serverId: number): Plan => (db.prepare('SELECT * FROM restart_plans WHERE server_id = ?').get(serverId) as Plan | undefined) ?? DEFAULT_PLAN(serverId);

function rconOf(serverId: number): { host: string; port: number; password: string } | null {
  const r = db.prepare('SELECT s.host, r.port, r.password FROM server_rcon r JOIN servers s ON s.id = r.server_id WHERE r.server_id = ?').get(serverId) as { host: string; port: number; password: string } | undefined;
  if (!r) return null;
  try {
    return { host: r.host, port: r.port, password: decryptSecret(r.password) };
  } catch {
    return null;
  }
}

const nameOf = (serverId: number) => (db.prepare(`SELECT ${EFFECTIVE_NAME} AS name FROM servers s LEFT JOIN status st ON st.server_id = s.id WHERE s.id = ?`).get(serverId) as { name: string } | undefined)?.name ?? `#${serverId}`;
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function discord(serverId: number, p: Plan, title: string, description: string, color: number) {
  enqueueAlert('restart', nameOf(serverId), { content: '', mention: 'none', embed: { title, description, color, timestamp: new Date().toISOString() } }, p.channel_id || undefined);
}

async function say(serverId: number, p: Plan, text: string): Promise<string | null> {
  const r = rconOf(serverId);
  if (!r || !p.say.trim()) return null;
  try {
    await rconCommand(r.host, r.port, r.password, p.say.replace('{text}', text));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** the restart itself: a maintenance window, the command, a report */
async function run(serverId: number, p: Plan, at: number, by = 'расписание'): Promise<string> {
  const now = Date.now();
  db.prepare('INSERT INTO maintenance_windows (server_id, name, start_ts, end_ts, repeat, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    serverId,
    'Плановый перезапуск',
    Math.min(at, now),
    Math.max(at, now) + p.duration_min * 60_000,
    'none',
    by,
    now,
  );
  let result = p.command.trim() ? 'Команда отправлена' : 'Окно обслуживания открыто (команды перезапуска нет)';
  const r = rconOf(serverId);
  if (p.command.trim()) {
    if (!r) result = 'Не отправлено: RCON не настроен';
    else {
      try {
        const answer = await rconCommand(r.host, r.port, r.password, p.command.trim());
        result = answer ? `Команда отправлена, сервер ответил: ${answer.slice(0, 200)}` : 'Команда отправлена';
      } catch (e) {
        result = `Не отправлено: ${(e as Error).message}`;
      }
    }
  }
  db.prepare('UPDATE restart_plans SET ran_for = ?, last_result = ?, last_run_at = ? WHERE server_id = ?').run(at, result, now, serverId);
  discord(serverId, p, '🔄 Плановый перезапуск', `Сервер **${nameOf(serverId)}** перезапускается. Обычно это занимает до ${p.duration_min} мин.`, 0x5865f2);
  return result;
}

/** one pass of the timer: warnings that are due, restarts that are due */
export async function tickRestarts(now = Date.now()): Promise<void> {
  const zone = tz();
  for (const p of db.prepare('SELECT * FROM restart_plans WHERE enabled = 1').all() as Plan[]) {
    // the restart that is due now (a run missed by less than 5 minutes still happens)
    const due = nextRun(p, now - 5 * 60_000, zone);
    if (due && due <= now && p.ran_for !== due) {
      await run(p.server_id, p, due);
      continue;
    }
    const next = nextRun(p, now, zone);
    if (!next || p.warn_min <= 0) continue;
    if (next - now <= p.warn_min * 60_000 && p.warned_for !== next) {
      db.prepare('UPDATE restart_plans SET warned_for = ? WHERE server_id = ?').run(next, p.server_id);
      const mins = Math.max(1, Math.round((next - now) / 60_000));
      discord(p.server_id, p, '⏳ Скоро перезапуск', `Сервер **${nameOf(p.server_id)}** перезапустится через ${mins} мин (в ${hhmm(p.at_min)}). Сохраните прогресс.`, 0xf0b232);
      await say(p.server_id, p, `Перезапуск сервера через ${mins} мин. Сохраните прогресс!`);
    }
  }
}

let timer: NodeJS.Timeout | undefined;
let busy = false;
export function startRestartTimer(): void {
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void tickRestarts().catch(() => undefined).finally(() => { busy = false; });
  }, 30_000);
  timer.unref();
}
export const stopRestartTimer = () => clearInterval(timer);

// ---------- routes ----------

const serverOf = (req: express.Request) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && (db.prepare('SELECT id, game FROM servers WHERE id = ?').get(id) as { id: number; game: string } | undefined);
};

function view(serverId: number, game: string) {
  const p = planOf(serverId);
  const r = db.prepare('SELECT port FROM server_rcon WHERE server_id = ?').get(serverId) as { port: number } | undefined;
  let suggestedHour: number | null = null;
  try {
    suggestedHour = analyticsFor(serverId, 30).heatmap.restartHour ?? null;
  } catch {
    suggestedHour = null;
  }
  return {
    enabled: !!p.enabled,
    days: p.days,
    atMin: p.at_min,
    durationMin: p.duration_min,
    warnMin: p.warn_min,
    channelId: p.channel_id,
    command: p.command,
    say: p.say || defaultSay(game),
    next: p.enabled ? nextRun(p, Date.now(), tz()) : null,
    lastResult: p.last_result,
    lastRunAt: p.last_run_at,
    suggestedHour,
    timezone: tz(),
    rcon: r ? { port: r.port, configured: true } : { port: null, configured: false },
  };
}

router.get('/api/servers/:id(\\d+)/restart', allow('maintenance'), (req, res) => {
  const s = serverOf(req);
  if (!s) return res.status(404).json({ error: 'Сервер не найден' });
  res.json(view(s.id, s.game));
});

router.put('/api/servers/:id(\\d+)/restart', allow('maintenance'), (req, res) => {
  const s = serverOf(req);
  if (!s) return res.status(404).json({ error: 'Сервер не найден' });
  const b = z
    .object({
      enabled: z.boolean(),
      days: z.number().int().min(0).max(127),
      atMin: z.number().int().min(0).max(1439),
      durationMin: z.number().int().min(1).max(240),
      warnMin: z.number().int().min(0).max(120),
      channelId: z.string().regex(/^(\d{15,25})?$/),
      command: z.string().trim().max(200),
      say: z.string().trim().max(200),
    })
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  const d = b.data;
  db.prepare(
    `INSERT INTO restart_plans (server_id, enabled, days, at_min, duration_min, warn_min, channel_id, command, say) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id) DO UPDATE SET enabled = excluded.enabled, days = excluded.days, at_min = excluded.at_min, duration_min = excluded.duration_min,
       warn_min = excluded.warn_min, channel_id = excluded.channel_id, command = excluded.command, say = excluded.say`,
  ).run(s.id, d.enabled ? 1 : 0, d.days, d.atMin, d.durationMin, d.warnMin, d.channelId, d.command, d.say);
  res.json(view(s.id, s.game));
});

router.put('/api/servers/:id(\\d+)/rcon', admin, (req, res) => {
  const s = serverOf(req);
  if (!s) return res.status(404).json({ error: 'Сервер не найден' });
  const b = z.object({ port: z.number().int().min(1).max(65535).nullable(), password: z.string().max(200).optional() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  if (b.data.port === null) {
    db.prepare('DELETE FROM server_rcon WHERE server_id = ?').run(s.id);
  } else {
    const old = db.prepare('SELECT password FROM server_rcon WHERE server_id = ?').get(s.id) as { password: string } | undefined;
    // an empty password field keeps the saved one
    const pass = b.data.password ? encryptSecret(b.data.password) : old?.password;
    if (!pass) return res.status(400).json({ error: 'Укажите пароль RCON' });
    db.prepare('INSERT INTO server_rcon (server_id, port, password) VALUES (?, ?, ?) ON CONFLICT(server_id) DO UPDATE SET port = excluded.port, password = excluded.password').run(s.id, b.data.port, pass);
  }
  res.json(view(s.id, s.game));
});

router.post('/api/servers/:id(\\d+)/rcon/test', admin, async (req, res) => {
  const s = serverOf(req);
  if (!s) return res.status(404).json({ error: 'Сервер не найден' });
  const b = z.object({ command: z.string().trim().min(1).max(200) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  const r = rconOf(s.id);
  if (!r) return res.status(400).json({ error: 'Сначала сохраните порт и пароль RCON' });
  try {
    res.json({ ok: true, answer: await rconCommand(r.host, r.port, r.password, b.data.command) });
  } catch (e) {
    res.json({ ok: false, answer: (e as Error).message });
  }
});

router.post('/api/servers/:id(\\d+)/restart/now', allow('maintenance'), async (req: AuthedRequest, res) => {
  const s = serverOf(req);
  if (!s) return res.status(404).json({ error: 'Сервер не найден' });
  const result = await run(s.id, planOf(s.id), Date.now(), req.user?.username ?? 'админка');
  res.json({ ...view(s.id, s.game), lastResult: result });
});
