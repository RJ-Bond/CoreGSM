/**
 * Restart of a game server by a timer.
 *
 * A restart is asked for in four places: «.restart 5m» in the game (administrators of the game), «restart 5m» in the
 * console of AMP, the panel and «/restart» of the Discord bot. All of them end here: a timer for the server is started,
 * the game chat is told «через 5 минут», «через 4 минуты» ... through the usual queue of the plugin, and when the time is
 * up the next poll of the plugin gets `restart: true`: the plugin saves the world and closes the server (AMP starts it again).
 * «restart cancel» stops a timer that is running.
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { db, getSetting, setSetting } from '../db.js';
import { log } from '../logger.js';
import { internal } from '../security/auth.js';
import { pluginTarget, queueNews } from './gameNews.js';
import { plainLine } from './gameNewsJoinLeave.js';
import {
  DEFAULT_TEXTS, announceLine, cancelLine, formatLeft, nextNotice, noticeSeconds, nowLine, parseDuration, type RestartTexts,
} from './gameNewsRestartLogic.js';
import { DUE_GRACE_MS, getJob, jobsIn, saveJob, setLastNotice, setState, type Job } from './gameNewsRestartState.js';
import { serverLabel } from './gameNewsVars.js';

// ---- the words of the notices (set in the panel)
export function getTexts(): RestartTexts {
  try {
    const v = JSON.parse(getSetting('gamenews_restart_texts') || '{}') as Partial<RestartTexts>;
    const pick = (x: unknown, d: string) => (typeof x === 'string' && x.trim() ? x : d);
    return { announce: pick(v.announce, DEFAULT_TEXTS.announce), now: pick(v.now, DEFAULT_TEXTS.now), cancel: pick(v.cancel, DEFAULT_TEXTS.cancel) };
  } catch {
    return { ...DEFAULT_TEXTS };
  }
}
const setTexts = (t: RestartTexts): void => setSetting('gamenews_restart_texts', JSON.stringify(t));

/** servers that have a game plugin (a token): only they can be restarted this way */
function pluginServers(): { id: number; name: string }[] {
  const ids = (db.prepare("SELECT server_id FROM game_news_targets WHERE token_hash <> ''").all() as { server_id: number }[]).map((r) => r.server_id);
  return ids.map((id) => ({ id, name: serverLabel(id) }));
}

const tellChat = (serverId: number, line: string, now: number): void => {
  // nobody in the game: nobody to tell (the restart still happens)
  queueNews(line, [serverId], 'авто: рестарт', now, { onlyOnline: true });
};

// ---- the timer
export function startRestart(serverId: number, seconds: number, by: string, source: string, now = Date.now()): Job {
  const job: Job = {
    server_id: serverId, run_at: now + seconds * 1000, started_at: now, total_sec: seconds, last_notice: seconds,
    requested_by: by.slice(0, 80), source: source.slice(0, 40), state: 'counting',
  };
  saveJob(job);
  tellChat(serverId, announceLine(getTexts(), seconds), now);
  log.info(`game restart of server ${serverId} in ${seconds} s (${source})`);
  return job;
}

/** true when a timer was running and is stopped */
export function cancelRestart(serverId: number, now = Date.now()): boolean {
  const j = getJob(serverId);
  if (!j || (j.state !== 'counting' && j.state !== 'due')) return false;
  setState(serverId, 'cancelled');
  tellChat(serverId, cancelLine(getTexts()), now);
  return true;
}

/** one pass: the notices that are due, the timers that ran out */
export function tickRestartJobs(now = Date.now()): void {
  for (const j of jobsIn('counting')) {
    const r = Math.ceil((j.run_at - now) / 1000);
    if (r <= 0) {
      setState(j.server_id, 'due');
      tellChat(j.server_id, nowLine(getTexts()), now);
      continue;
    }
    const p = nextNotice(r, j.last_notice);
    if (p !== null) {
      setLastNotice(j.server_id, p);
      tellChat(j.server_id, announceLine(getTexts(), noticeSeconds(p, r)), now);
    }
  }
  for (const j of jobsIn('due')) if (now - j.run_at > DUE_GRACE_MS) setState(j.server_id, 'missed');
}

let timer: NodeJS.Timeout | undefined;
let busy = false;
export function startRestartJobsTimer(): void {
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    try { tickRestartJobs(); } catch (e) { log.error('game restart timer failed', (e as Error).message); } finally { busy = false; }
  }, 5000);
  timer.unref();
}
export const stopRestartJobsTimer = () => clearInterval(timer);

/**
 * What a person typed after «restart»: a time («5m»), «cancel», or nothing (what is going on now).
 * The answer is plain text for the person: the game, the console, Discord.
 */
export function runRestartCommand(serverId: number, raw: string, by: string, source: string, now = Date.now()): { ok: boolean; text: string } {
  const arg = raw.trim().toLowerCase();
  const job = getJob(serverId);
  const running = job && (job.state === 'counting' || job.state === 'due') ? job : undefined;
  if (!arg) {
    return running
      ? { ok: true, text: `Рестарт через ${formatLeft(Math.max(0, Math.ceil((running.run_at - now) / 1000)))} (запустил ${running.requested_by || '—'}). Отмена: restart cancel` }
      : { ok: true, text: 'Введите время: restart 5m (минуты, секунды 30s, часы 1h) или restart cancel' };
  }
  if (['cancel', 'stop', 'отмена', 'отменить', 'стоп'].includes(arg)) {
    return cancelRestart(serverId, now) ? { ok: true, text: 'Рестарт отменён.' } : { ok: false, text: 'Сейчас нет запущенного рестарта.' };
  }
  const d = parseDuration(arg);
  if ('error' in d) {
    return { ok: false, text: d.error === 'format' ? 'Не понял время. Примеры: 5m, 5м, 30s, 1h, 90' : d.error === 'short' ? 'Слишком мало: от 10 секунд.' : 'Слишком много: не больше 6 часов.' };
  }
  startRestart(serverId, d.seconds, by, source, now);
  return { ok: true, text: `Рестарт сервера через ${formatLeft(d.seconds)}.` };
}

const C_OK = '#5FD068';
const C_BAD = '#FF5555';

export function registerGameNewsServerRestart({ app, admin }: { app: Express; admin: RequestHandler }): void {
  // ---- the panel
  app.get('/api/game-news/restart', admin, (_req, res) => {
    const now = Date.now();
    const jobs = jobsIn('counting', 'due', 'sent').map((j) => ({
      serverId: j.server_id, serverName: serverLabel(j.server_id), runAt: j.run_at, by: j.requested_by, source: j.source, state: j.state,
      left: Math.max(0, Math.ceil((j.run_at - now) / 1000)),
    }));
    res.json({ jobs, texts: getTexts(), servers: pluginServers() });
  });

  app.post('/api/game-news/restart', admin, (req, res) => {
    const b = z.object({ serverId: z.number().int().positive(), time: z.string().max(40) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    if (!pluginServers().some((s) => s.id === b.data.serverId)) return res.status(400).json({ error: 'Выберите сервер с плагином' });
    const d = parseDuration(b.data.time);
    if ('error' in d) {
      if (d.error === 'short') return res.status(400).json({ error: 'Минимум 10 секунд' });
      if (d.error === 'long') return res.status(400).json({ error: 'Не больше 6 часов' });
      return res.status(400).json({ error: 'Время не распознано: введите, например, 5m, 30s или 1h' });
    }
    const user = (req as typeof req & { user?: { username?: string } }).user?.username ?? '';
    const job = startRestart(b.data.serverId, d.seconds, user, 'панель');
    res.json({ ok: true, runAt: job.run_at });
  });

  app.delete('/api/game-news/restart/:serverId', admin, (req, res) => {
    res.json({ ok: cancelRestart(Number(req.params.serverId)) });
  });

  app.put('/api/game-news/restart-texts', admin, (req, res) => {
    const b = z.object({ announce: z.string().max(300), now: z.string().max(300), cancel: z.string().max(300) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    const d = getTexts();
    const keep = (x: string, old: string) => plainLine(x) || old;
    setTexts({ announce: keep(b.data.announce, d.announce), now: keep(b.data.now, d.now), cancel: keep(b.data.cancel, d.cancel) });
    res.json({ ok: true });
  });

  // ---- the plugin: «.restart 5m» in the game or «restart 5m» in the console of AMP
  app.post('/api/game-news/restart-request', (req, res) => {
    const t = pluginTarget(req);
    if (!t) return res.status(401).json({ error: 'unauthorized' });
    const b = z.object({ text: z.string().max(60), by: z.string().max(80) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    const r = runRestartCommand(t.server_id, b.data.text, b.data.by || 'игра', 'игра');
    res.json({ ok: r.ok, text: r.text, replies: [`<color=${r.ok ? C_OK : C_BAD}>* ${plainLine(r.text)}</color>`] });
  });

  // ---- the Discord bot (it is trusted; the person is checked here)
  app.post('/internal/game-restart', internal, (req, res) => {
    const b = z.object({
      action: z.enum(['start', 'cancel', 'status']),
      time: z.string().max(40).optional(),
      server: z.string().max(100).optional(),
      discordId: z.string().max(32),
      discordAdmin: z.boolean(),
    }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ ok: false, text: 'Проверьте поля' });
    // a server administrator of Discord, or a Discord account linked to an administrator of the panel
    const linked = db.prepare("SELECT username FROM users WHERE discord_id = ? AND role = 'admin' AND status = 'active'").get(b.data.discordId) as { username: string } | undefined;
    if (!b.data.discordAdmin && !linked) return res.json({ ok: false, text: 'Эта команда только для администраторов.' });

    const servers = pluginServers();
    const q = (b.data.server ?? '').trim().toLowerCase();
    const found = q ? servers.filter((s) => s.name.toLowerCase().includes(q)) : servers;
    if (found.length === 0) return res.json({ ok: false, text: q ? 'Сервер не найден среди серверов с плагином.' : 'Нет серверов с плагином CoreGSM.' });
    if (found.length > 1) return res.json({ ok: false, text: `Укажите сервер: ${found.map((s) => s.name).join(', ')}` });
    const text = b.data.action === 'cancel' ? 'cancel' : b.data.action === 'status' ? '' : (b.data.time ?? '');
    const r = runRestartCommand(found[0].id, text, linked?.username ?? `Discord ${b.data.discordId}`, 'Discord');
    res.json({ ok: r.ok, text: `${found[0].name}: ${r.text}` });
  });
}
