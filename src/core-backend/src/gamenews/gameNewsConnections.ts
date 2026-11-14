/**
 * Who came to a game server and who went, and why (plugin 0.18+): the plugin sends what the game said about each departure
 * (a quit, a timeout, a kick…), how long the player was in and whether CoreGSM removed him. The panel keeps it for 30 days and shows
 * it on the Moderation tab, so a complaint «I was kicked for nothing» can be checked from the panel.
 * Also here: several timeouts on one server within a minute (the network or a frozen server) and a plugin that could not patch the
 * game (after an update of the game) are told in the service channel; the button «Обновить плагин»; the language of the plugin.
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { systemTarget } from '../alerts/alertRoute.js';
import { alertSettings, enqueueAlert } from '../alerts/alerts.js';
import { db } from '../db.js';
import { pluginTarget } from './gameNews.js';
import { plainLine } from './gameNewsJoinLeave.js';
import { commandState, queueCommand } from './gameNewsModLog.js';
import { writeScoped } from './gameNewsScope.js';
import { serverLabel } from './gameNewsVars.js';

db.exec(`
CREATE TABLE IF NOT EXISTS game_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  platform_id TEXT NOT NULL DEFAULT '',
  nick TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  removed_by TEXT NOT NULL DEFAULT '',
  minutes INTEGER NOT NULL DEFAULT -1
);
CREATE INDEX IF NOT EXISTS idx_game_connections_ts ON game_connections(server_id, ts);
CREATE INDEX IF NOT EXISTS idx_game_connections_nick ON game_connections(nick COLLATE NOCASE);
`);

const KEEP_MS = 30 * 86_400_000;
/** this many timeouts on one server within the window make an alert */
export const TIMEOUT_ALERT_COUNT = 3;
const TIMEOUT_WINDOW_MS = 60_000;
/** not more often than this for one server */
const ALERT_PAUSE_MS = 10 * 60_000;
const lastAlert = new Map<string, number>();

export interface ConnectionEvent { kind: 'join' | 'leave'; id: string; name: string; reason: string; by: string; minutes: number; at: number }

function alertOnce(key: string, now: number, send: () => void): boolean {
  if (now - (lastAlert.get(key) ?? 0) < ALERT_PAUSE_MS) return false;
  lastAlert.set(key, now);
  try { send(); } catch { /* an alert must not stop the journal */ }
  return true;
}

/** keeps the events of a server; true when they made a «many timeouts» alert */
export function saveConnections(serverId: number, events: ConnectionEvent[], now = Date.now()): boolean {
  const insert = db.prepare('INSERT INTO game_connections (server_id, ts, kind, platform_id, nick, reason, removed_by, minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const e of events) {
      // the time of the plugin, unless it is far off (a wrong clock on the game server)
      const ts = Math.abs(e.at - now) < 3_600_000 ? e.at : now;
      insert.run(serverId, ts, e.kind, e.id.slice(0, 25), plainLine(e.name).slice(0, 100), plainLine(e.reason).slice(0, 100), plainLine(e.by).slice(0, 200), Math.round(e.minutes));
    }
  })();
  db.prepare('DELETE FROM game_connections WHERE ts < ?').run(now - KEEP_MS);

  if (!events.some((e) => e.kind === 'leave' && /^timeout/i.test(e.reason))) return false;
  const n = (db.prepare("SELECT COUNT(*) AS n FROM game_connections WHERE server_id = ? AND kind = 'leave' AND reason LIKE 'Timeout%' AND ts >= ?").get(serverId, now - TIMEOUT_WINDOW_MS) as { n: number }).n;
  if (n < TIMEOUT_ALERT_COUNT) return false;
  return alertOnce(`timeout:${serverId}`, now, () => {
    if (!systemTarget(alertSettings())) return;
    const name = serverLabel(serverId);
    enqueueAlert('update', name, {
      content: '', mention: 'none',
      embed: {
        title: '📶 Игроки массово отваливаются по таймауту',
        description: `Сервер **${name}**: за последнюю минуту по таймауту отключились ${n} игроков. Обычно это сеть или подвисший сервер (нагрузка, сохранение мира, нехватка памяти). Журнал входов и выходов: «Игровой плагин» → «Модерация».`,
        color: 0xf5b01e,
        timestamp: new Date(now).toISOString(),
      },
    });
  });
}

/** what the plugin could not do (a patch that no longer fits the game): kept with the server, told once when it changes */
export function savePluginProblems(serverId: number, header: string, now = Date.now()): void {
  const problems = header.trim().toLowerCase() === 'none' ? '' : header.split(',').map((x) => x.replace(/[^\w.-]/g, '').slice(0, 40)).filter(Boolean).slice(0, 10).join(', ');
  const row = db.prepare('SELECT plugin_problems FROM game_news_targets WHERE server_id = ?').get(serverId) as { plugin_problems: string } | undefined;
  if (!row || row.plugin_problems === problems) return;
  db.prepare('UPDATE game_news_targets SET plugin_problems = ? WHERE server_id = ?').run(problems, serverId);
  if (!problems) return;
  alertOnce(`problems:${serverId}:${problems}`, now, () => {
    if (!systemTarget(alertSettings())) return;
    const name = serverLabel(serverId);
    enqueueAlert('update', name, {
      content: '', mention: 'none',
      embed: {
        title: '🧩 Игровой плагин работает не полностью',
        description: `Сервер **${name}**: плагин CoreGSM не смог подключиться к части игры (${problems}). Так бывает после обновления V Rising. Обновите плагин: «Игровой плагин» → сервер → «Обновить плагин».`,
        color: 0xed4245,
        timestamp: new Date(now).toISOString(),
      },
    });
  });
}

export function registerGameNewsConnections({ app, admin }: { app: Express; admin: RequestHandler }): void {
  // the plugin: a batch of joins and departures; a field that is too long is cut, not a reason to refuse the batch
  const cut = (n: number) => z.string().max(2000).transform((s) => s.slice(0, n));
  app.post('/api/game-news/connections', (req, res) => {
    const t = pluginTarget(req);
    if (!t) return res.status(401).json({ error: 'unauthorized' });
    const b = z.object({
      events: z.array(z.object({
        kind: z.enum(['join', 'leave']), id: z.string().max(25), name: cut(100), reason: cut(100).default(''),
        by: cut(300).default(''), minutes: z.number().int().min(-1).max(100_000).default(-1), at: z.number().int().positive(),
      })).max(100),
    }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad' });
    saveConnections(t.server_id, b.data.events);
    res.json({ ok: true });
  });

  // the panel: the journal (by nickname and server), newest first
  app.get('/api/game-news/connections', admin, (req, res) => {
    const nick = String(req.query.player ?? '').trim().toLowerCase();
    const server = Number(req.query.server);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (nick) { where.push('ulower(nick) LIKE ?'); args.push(`%${nick}%`); }
    if (Number.isInteger(server) && server > 0) { where.push('server_id = ?'); args.push(server); }
    const rows = db.prepare(`SELECT * FROM game_connections ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ts DESC, id DESC LIMIT ?`).all(...args, limit) as {
      id: number; server_id: number; ts: number; kind: string; platform_id: string; nick: string; reason: string; removed_by: string; minutes: number;
    }[];
    res.json({ items: rows.map((r) => ({ id: r.id, serverName: serverLabel(r.server_id), ts: r.ts, kind: r.kind, platformId: r.platform_id, nick: r.nick, reason: r.reason, removedBy: r.removed_by, minutes: r.minutes })) });
  });

  // «Обновить плагин»: the plugin downloads the newest release; it takes effect at the next restart of the server
  app.post('/api/game-news/targets/:id/update', admin, (req, res) => {
    const id = Number(req.params.id);
    const t = db.prepare("SELECT server_id FROM game_news_targets WHERE server_id = ? AND token_hash <> ''").get(id);
    if (!t) return res.status(404).json({ error: 'Сервер не найден' });
    res.json({ id: queueCommand(id, 'update', {}, Date.now()) });
  });

  // how a command given from the panel went
  app.get('/api/game-news/commands/:id', admin, (req, res) => {
    const c = commandState(Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Не найдено' });
    res.json({ state: c.state, result: c.result });
  });

  // the language of the lines that the plugin writes itself (help of the commands, errors)
  app.put('/api/game-news/targets/:id/lang', admin, (req, res) => {
    const id = Number(req.params.id);
    const b = z.object({ lang: z.enum(['ru', 'en']) }).safeParse(req.body);
    if (!Number.isInteger(id) || id <= 0 || !b.success) return res.status(400).json({ error: 'Проверьте поля' });
    writeScoped('gamenews_lang', b.data.lang, id);
    res.json({ ok: true });
  });
}
