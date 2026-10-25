/**
 * The wipe scenario of a server: one plan that holds everything around a wipe, in order.
 *
 *   before   a message in Discord (e.g. 24 h, 1 h and 10 min before) and a line in the game chat (RCON)
 *   at wipe  the maintenance window → the wipe commands over RCON (the new seed goes in {seed}) →
 *            a new season (the hall of fame closes the old one) → the news item «вайп прошёл» → a message in Discord
 *
 * It composes what the panel already does: the RCON of the restart plan, the maintenance windows, the news queue and
 * the seasons. Every step runs once (done_steps is written before the step starts); a scenario that the panel missed
 * by more than half an hour (it was off) is marked «missed» and nothing is run late.
 *
 *   GET    /api/servers/:id/wipes   the scenarios of a server, the next first (permission «Обслуживание»)
 *   POST   /api/servers/:id/wipes   plan a wipe
 *   PUT    /api/wipes/:id           change a scenario that has not started
 *   DELETE /api/wipes/:id           cancel a planned scenario / remove a finished one
 */
import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { allow, type AuthedRequest } from './auth.js';
import { enqueueAlert } from './alerts.js';
import { db, EFFECTIVE_NAME, getSetting } from './db.js';
import { param } from './http.js';
import { resetMaintenanceCache } from './maintenance.js';
import { rconRun, rconSay } from './restarts.js';
import { startSeason } from './seasons.js';
import { fill, leadText } from './wipeLogic.js';
import { log } from './logger.js';

export const router = express.Router();

db.exec(`
CREATE TABLE IF NOT EXISTS wipe_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  wipe_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  announce_min TEXT NOT NULL DEFAULT '[]',
  say_min TEXT NOT NULL DEFAULT '[]',
  channel_id TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL DEFAULT 15,
  commands TEXT NOT NULL DEFAULT '[]',
  seed_mode TEXT NOT NULL DEFAULT 'none',
  seed TEXT NOT NULL DEFAULT '',
  season_name TEXT NOT NULL DEFAULT '',
  news_channel_id TEXT NOT NULL DEFAULT '',
  news_title TEXT NOT NULL DEFAULT '',
  news_text TEXT NOT NULL DEFAULT '',
  mention TEXT NOT NULL DEFAULT 'none',
  done_steps TEXT NOT NULL DEFAULT '[]',
  steps_log TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wipes_server ON wipe_scenarios(server_id, wipe_at);
`);

interface Row {
  id: number; server_id: number; name: string; wipe_at: number; status: string; announce_min: string; say_min: string; channel_id: string;
  duration_min: number; commands: string; seed_mode: string; seed: string; season_name: string; news_channel_id: string; news_title: string;
  news_text: string; mention: string; done_steps: string; steps_log: string; created_by: string; created_at: number;
}
interface StepLog { step: string; ok: boolean; text: string; at: number }

const GRACE_MS = 30 * 60_000;
const json = <T,>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };
const tz = () => getSetting('timezone') || process.env.TZ || 'Europe/Moscow';
const nameOf = (serverId: number) => (db.prepare(`SELECT ${EFFECTIVE_NAME} AS name FROM servers s LEFT JOIN status st ON st.server_id = s.id WHERE s.id = ?`).get(serverId) as { name: string } | undefined)?.name ?? `#${serverId}`;

export function whenText(ts: number): { date: string; time: string } {
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString('ru-RU', { timeZone: tz(), day: 'numeric', month: 'long' }),
    time: d.toLocaleTimeString('ru-RU', { timeZone: tz(), hour: '2-digit', minute: '2-digit' }),
  };
}

const randomSeed = () => String(crypto.randomInt(1, 2_147_483_647));

function view(r: Row) {
  const steps = json<StepLog[]>(r.steps_log, []);
  return {
    id: r.id,
    serverId: r.server_id,
    name: r.name,
    wipeAt: r.wipe_at,
    status: r.status,
    announceMin: json<number[]>(r.announce_min, []),
    sayMin: json<number[]>(r.say_min, []),
    channelId: r.channel_id,
    durationMin: r.duration_min,
    commands: json<string[]>(r.commands, []),
    seedMode: r.seed_mode,
    seed: r.seed,
    seasonName: r.season_name,
    newsChannelId: r.news_channel_id,
    newsTitle: r.news_title,
    newsText: r.news_text,
    mention: r.mention,
    steps,
    failed: steps.filter((s) => !s.ok).length,
    createdBy: r.created_by,
  };
}

function discord(serverId: number, channelId: string, title: string, description: string, color: number, mention = 'none') {
  enqueueAlert('restart', nameOf(serverId), { content: '', mention: mention as 'none' | 'here' | 'everyone', embed: { title, description, color, timestamp: new Date().toISOString() } }, channelId || undefined);
}

const save = (id: number, done: Set<string>, steps: StepLog[], status?: string) =>
  db.prepare('UPDATE wipe_scenarios SET done_steps = ?, steps_log = ?, status = COALESCE(?, status) WHERE id = ?').run(JSON.stringify([...done]), JSON.stringify(steps), status ?? null, id);

/** the wipe itself, every step once, in order; a failed step is logged and the next one still runs */
async function runWipe(r: Row, done: Set<string>, steps: StepLog[]): Promise<void> {
  const now = Date.now();
  const server = nameOf(r.server_id);
  const seed = r.seed_mode === 'random' ? randomSeed() : r.seed_mode === 'fixed' ? r.seed : '';
  const w = whenText(r.wipe_at);
  const vars = { server, date: w.date, time: w.time, seed };
  const step = async (key: string, fn: () => Promise<string> | string) => {
    try {
      steps.push({ step: key, ok: true, text: await fn(), at: Date.now() });
    } catch (e) {
      steps.push({ step: key, ok: false, text: (e as Error).message, at: Date.now() });
    }
    save(r.id, done, steps);
  };

  await step('window', () => {
    db.prepare('INSERT INTO maintenance_windows (server_id, name, start_ts, end_ts, repeat, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      r.server_id, `Вайп: ${r.name}`, Math.min(r.wipe_at, now), Math.max(r.wipe_at, now) + r.duration_min * 60_000, 'none', 'сценарий вайпа', now,
    );
    resetMaintenanceCache();
    return `Окно обслуживания на ${r.duration_min} мин`;
  });

  const commands = json<string[]>(r.commands, []);
  if (commands.length) {
    await step('commands', async () => {
      const answers: string[] = [];
      for (const c of commands) {
        const answer = await rconRun(r.server_id, fill(c, vars));
        if (answer) answers.push(answer.slice(0, 100));
      }
      return `Команд отправлено: ${commands.length}${answers.length ? `; ответ сервера: ${answers.join(' | ')}` : ''}`;
    });
  }

  if (r.season_name.trim()) {
    await step('season', () => {
      startSeason(fill(r.season_name, vars).slice(0, 60), r.wipe_at);
      return `Начат сезон «${fill(r.season_name, vars).slice(0, 60)}»`;
    });
  }

  if (r.news_channel_id && r.news_title.trim()) {
    await step('news', () => {
      const payload = {
        content: '',
        mention: r.mention,
        category: 'wipe',
        embed: { title: fill(r.news_title, vars).slice(0, 256), description: fill(r.news_text, vars).slice(0, 4000), color: 0xf0b232, timestamp: true },
      };
      db.prepare("INSERT INTO news (status, channel_id, payload, repeat, created_at, updated_at) VALUES ('queued', ?, ?, 'none', ?, ?)").run(r.news_channel_id, JSON.stringify(payload), now, now);
      return 'Новость поставлена в очередь';
    });
  }

  await step('discord', () => {
    discord(r.server_id, r.channel_id, '🧹 Вайп', `Сервер **${server}** вайпается. Обычно это занимает до ${r.duration_min} мин.${seed ? `\nСид: \`${seed}\`` : ''}`, 0x5865f2);
    return 'Сообщение в Discord поставлено в очередь';
  });
  save(r.id, done, steps, 'done');
}

/** one pass of the timer: the announcements that are due, the wipes that are due */
export async function tickWipes(now = Date.now()): Promise<void> {
  const rows = db.prepare("SELECT * FROM wipe_scenarios WHERE status = 'scheduled' ORDER BY wipe_at").all() as Row[];
  for (const r of rows) {
    const done = new Set(json<string[]>(r.done_steps, []));
    const steps = json<StepLog[]>(r.steps_log, []);
    const w = whenText(r.wipe_at);
    const vars = { server: nameOf(r.server_id), date: w.date, time: w.time, seed: '' };
    if (now < r.wipe_at) {
      // of the announcements that are due only the closest one is sent (the panel may have been off for a while)
      const dueOf = (kind: 'a' | 's', list: number[]) => list.filter((m) => now >= r.wipe_at - m * 60_000 && !done.has(`${kind}${m}`)).sort((x, y) => x - y);
      const ann = dueOf('a', json<number[]>(r.announce_min, []));
      if (ann.length) {
        for (const m of ann) done.add(`a${m}`);
        save(r.id, done, steps);
        const left = Math.max(1, Math.round((r.wipe_at - now) / 60_000));
        discord(r.server_id, r.channel_id, '🧹 Скоро вайп', `Сервер **${vars.server}** вайпнется ${w.date} в ${w.time} (через ${leadText(left)}). Соберите вещи и сохраните прогресс.`, 0xf0b232, r.mention);
      }
      const sy = dueOf('s', json<number[]>(r.say_min, []));
      if (sy.length) {
        for (const m of sy) done.add(`s${m}`);
        save(r.id, done, steps);
        const left = Math.max(1, Math.round((r.wipe_at - now) / 60_000));
        const err = await rconSay(r.server_id, `Вайп сервера через ${leadText(left)}!`).catch((e: Error) => e.message);
        if (err) { steps.push({ step: 'say', ok: false, text: err, at: now }); save(r.id, done, steps); }
      }
      continue;
    }
    if (done.has('run')) continue;
    if (now - r.wipe_at > GRACE_MS) {
      steps.push({ step: 'missed', ok: false, text: 'Панель была выключена в момент вайпа: сценарий не запущен', at: now });
      save(r.id, done, steps, 'missed');
      continue;
    }
    done.add('run');
    save(r.id, done, steps, 'scheduled');
    await runWipe(r, done, steps);
  }
}

let timer: NodeJS.Timeout | undefined;
let busy = false;
export function startWipeTimer(): void {
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void tickWipes().catch((e) => log.error('wipe timer failed', (e as Error).message)).finally(() => { busy = false; });
  }, 30_000);
  timer.unref();
}
export const stopWipeTimer = () => clearInterval(timer);

// ---------- routes ----------

const serverOf = (req: express.Request) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && (db.prepare('SELECT id FROM servers WHERE id = ?').get(id) as { id: number } | undefined);
};

const channel = z.string().regex(/^(\d{15,25})?$/);
const minutes = (max: number, n: number) => z.array(z.number().int().min(1).max(max)).max(n).transform((l) => [...new Set(l)].sort((a, b) => b - a));
const bodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  wipeAt: z.number().int().positive(),
  announceMin: minutes(10_080, 6),
  sayMin: minutes(180, 4),
  channelId: channel,
  durationMin: z.number().int().min(1).max(240),
  commands: z.array(z.string().trim().min(1).max(200)).max(20),
  seedMode: z.enum(['none', 'random', 'fixed']),
  seed: z.string().trim().max(40).regex(/^[\w-]*$/),
  seasonName: z.string().trim().max(60),
  newsChannelId: channel,
  newsTitle: z.string().trim().max(200),
  newsText: z.string().trim().max(2000),
  mention: z.enum(['none', 'here', 'everyone']),
});

const BAD = 'Проверьте сценарий: у вайпа есть название и время, в команде не больше 200 символов';
const IN_PAST = 'Время вайпа должно быть в будущем';

function values(b: z.infer<typeof bodySchema>) {
  return [b.name, b.wipeAt, JSON.stringify(b.announceMin), JSON.stringify(b.sayMin), b.channelId, b.durationMin, JSON.stringify(b.commands), b.seedMode, b.seedMode === 'fixed' ? b.seed : '', b.seasonName, b.newsChannelId, b.newsTitle, b.newsText, b.mention] as const;
}

router.get('/api/servers/:id/wipes', param('id'), allow('maintenance'), (req, res) => {
  const s = serverOf(req);
  if (!s) return res.status(404).json({ error: 'Сервер не найден' });
  const rows = db.prepare("SELECT * FROM wipe_scenarios WHERE server_id = ? ORDER BY (status = 'scheduled') DESC, CASE WHEN status = 'scheduled' THEN wipe_at END ASC, wipe_at DESC LIMIT 20").all(s.id) as Row[];
  res.json(rows.map(view));
});

router.post('/api/servers/:id/wipes', param('id'), allow('maintenance'), (req, res) => {
  const s = serverOf(req);
  if (!s) return res.status(404).json({ error: 'Сервер не найден' });
  const b = bodySchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: BAD });
  if (b.data.wipeAt < Date.now() + 60_000) return res.status(400).json({ error: IN_PAST });
  const info = db
    .prepare('INSERT INTO wipe_scenarios (server_id, name, wipe_at, announce_min, say_min, channel_id, duration_min, commands, seed_mode, seed, season_name, news_channel_id, news_title, news_text, mention, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(s.id, ...values(b.data), (req as AuthedRequest).user?.username ?? '', Date.now());
  res.status(201).json(view(db.prepare('SELECT * FROM wipe_scenarios WHERE id = ?').get(info.lastInsertRowid) as Row));
});

router.put('/api/wipes/:id', param('id'), allow('maintenance'), (req, res) => {
  const row = db.prepare('SELECT * FROM wipe_scenarios WHERE id = ?').get(Number(req.params.id)) as Row | undefined;
  if (!row) return res.status(404).json({ error: 'Сценарий не найден' });
  if (row.status !== 'scheduled' || json<string[]>(row.done_steps, []).includes('run')) return res.status(409).json({ error: 'Сценарий уже запущен или завершён' });
  const b = bodySchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: BAD });
  if (b.data.wipeAt < Date.now() + 60_000) return res.status(400).json({ error: IN_PAST });
  // a changed time starts the announcements over: the ones already sent were for the old date
  const reset = b.data.wipeAt !== row.wipe_at;
  db.prepare('UPDATE wipe_scenarios SET name = ?, wipe_at = ?, announce_min = ?, say_min = ?, channel_id = ?, duration_min = ?, commands = ?, seed_mode = ?, seed = ?, season_name = ?, news_channel_id = ?, news_title = ?, news_text = ?, mention = ?, done_steps = CASE WHEN ? THEN \'[]\' ELSE done_steps END WHERE id = ?')
    .run(...values(b.data), reset ? 1 : 0, row.id);
  res.json(view(db.prepare('SELECT * FROM wipe_scenarios WHERE id = ?').get(row.id) as Row));
});

router.delete('/api/wipes/:id', param('id'), allow('maintenance'), (req, res) => {
  const row = db.prepare('SELECT status, done_steps FROM wipe_scenarios WHERE id = ?').get(Number(req.params.id)) as Pick<Row, 'status' | 'done_steps'> | undefined;
  if (!row) return res.status(404).json({ error: 'Сценарий не найден' });
  // a planned wipe is cancelled (and stays in the list); a cancelled or finished one is removed
  if (row.status === 'scheduled') {
    if (json<string[]>(row.done_steps, []).includes('run')) return res.status(409).json({ error: 'Сценарий уже запущен или завершён' });
    db.prepare("UPDATE wipe_scenarios SET status = 'cancelled' WHERE id = ?").run(Number(req.params.id));
  } else db.prepare('DELETE FROM wipe_scenarios WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
