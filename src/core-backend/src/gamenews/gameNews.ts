/**
 * Game news: the panel writes a message and the CoreGSM game plugin (BepInEx, on the game server) shows it in the
 * in-game chat. Nothing listens on the game server: the plugin polls the panel.
 *
 *  - the panel issues a token per server (only its SHA-256 is kept) that the administrator pastes into the plugin config;
 *  - «send» puts the message into the queue (game_news_log, status 'queued');
 *  - the plugin calls  GET /api/game-news/pull  with  Authorization: Bearer <token>  every few seconds, gets the queued
 *    messages and they become 'delivered' (at most once: a crash of the plugin never repeats a message);
 *  - a message nobody picked up within QUEUE_TTL_MS becomes 'expired' (an old «restart in 5 minutes» must not arrive late).
 */
import crypto from 'node:crypto';
import type { Express, Request, RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { applyVars, checkNews } from './gameNewsLogic.js';
import { NAME_SQL, ONLINE_MS, chatKindsConfigured, liveState, registerEnabled, serverLabel, varsFor } from './gameNewsVars.js';

export { ONLINE_MS };
import { joinLeaveFor } from './gameNewsJoinLeave.js';
import { welcomeFor } from './gameNewsWelcome.js';
import { consumeDue } from './gameNewsRestartState.js';

export const QUEUE_TTL_MS = 5 * 60_000;
/** the version of the game plugin this panel was built for: an older plugin is shown as outdated */
export const PLUGIN_VERSION = '0.11.0';
/** the games the plugin exists for */
export const SUPPORTED_GAMES = new Set(['vrising']);
const PULL_MIN_GAP_MS = 800;
const PULL_BATCH = 5;
const MIN_GAP_MS = 2000;

export interface TargetRow { server_id: number; token_hash: string; last_seen: number; plugin_version: string; plugin_name: string; plugin_players: number; plugin_max: number }
interface LogRow { id: number; server_id: number | null; server_name: string; text: string; status: string; error: string; sent_by: string; sent_at: number; delivered_at: number | null }

let lastSend = 0;
const lastPull = new Map<number, number>();

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const actor = (req: Request) => (req as Request & { user?: { username?: string } }).user?.username ?? '';
const sendSchema = z.object({
  serverIds: z.array(z.number().int().positive()).min(1).max(50),
  text: z.string(),
});

/** queued messages that waited too long stop being valid */
function expireOld(now = Date.now()): void {
  db.prepare("UPDATE game_news_log SET status = 'expired', error = 'Плагин не забрал сообщение за 5 минут' WHERE status = 'queued' AND sent_at < ?").run(now - QUEUE_TTL_MS);
}

/** the server whose plugin sent this request (Authorization: Bearer <token>), or null */
export function pluginTarget(req: Request): TargetRow | null {
  const m = /^Bearer ([0-9a-f]{20,100})$/i.exec(String(req.headers.authorization ?? ''));
  if (!m) return null;
  return (db.prepare('SELECT * FROM game_news_targets WHERE token_hash = ?').get(sha256(m[1])) as TargetRow | undefined) ?? null;
}

export interface QueueResult { serverId: number; serverName: string; queued: boolean; online: boolean; error: string; logId?: number }

/**
 * Puts a message into the queue of the given servers ([] = every server that has a plugin token).
 * onlyOnline: a server with nobody playing is skipped (an automatic announcement to an empty server is noise).
 */
export function queueNews(text: string, serverIds: number[], by: string, now: number, opts: { onlyOnline?: boolean } = {}): QueueResult[] {
  const insert = db.prepare('INSERT INTO game_news_log (server_id, server_name, text, ok, status, error, sent_by, sent_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)');
  const ids = serverIds.length
    ? [...new Set(serverIds)]
    : (db.prepare("SELECT server_id FROM game_news_targets WHERE token_hash <> ''").all() as { server_id: number }[]).map((r) => r.server_id);
  const results: QueueResult[] = [];
  db.transaction(() => {
    for (const id of ids) {
      const name = serverLabel(id);
      const t = db.prepare('SELECT * FROM game_news_targets WHERE server_id = ?').get(id) as TargetRow | undefined;
      if (!t?.token_hash) {
        const error = 'Для сервера не создан токен плагина';
        insert.run(id, name, text, 'failed', error, by, now);
        results.push({ serverId: id, serverName: name, queued: false, online: false, error });
        continue;
      }
      const s = liveState(id, now);
      if (opts.onlyOnline && (!s || !s.online || s.players <= 0)) continue; // nobody to read it
      // the variables ({server} {online} {max} {time} {greeting} {restart} {wipe} {discord} {tip}) are filled in for each server
      const filled = applyVars(text, varsFor(id, now));
      const row = insert.run(id, name, filled, 'queued', '', by, now);
      results.push({ serverId: id, serverName: name, queued: true, online: t.last_seen > 0 && now - t.last_seen < ONLINE_MS, error: '', logId: Number(row.lastInsertRowid) });
    }
    db.prepare('DELETE FROM game_news_log WHERE id NOT IN (SELECT id FROM game_news_log ORDER BY id DESC LIMIT 500)').run();
  })();
  return results;
}

export function registerGameNews({ app, admin }: { app: Express; admin: RequestHandler }): void {
  const servers = () => {
    const rows = db.prepare(`SELECT s.id, ${NAME_SQL} AS name, s.host || ':' || s.port AS address, s.game FROM servers s LEFT JOIN status st ON st.server_id = s.id LEFT JOIN game_news_targets t ON t.server_id = s.id ORDER BY s.id`).all() as { id: number; name: string; address: string; game: string }[];
    const targets = new Map((db.prepare('SELECT * FROM game_news_targets').all() as TargetRow[]).map((t) => [t.server_id, t]));
    const now = Date.now();
    return rows.map((s) => {
      const t = targets.get(s.id);
      return {
        id: s.id, name: s.name, address: s.address, game: s.game, supported: SUPPORTED_GAMES.has(s.game),
        hasToken: !!t?.token_hash,
        lastSeen: t?.last_seen || null,
        online: !!t && t.last_seen > 0 && now - t.last_seen < ONLINE_MS,
        pluginVersion: t?.plugin_version ?? '',
        players: liveState(s.id, now)?.players ?? null,
        maxPlayers: liveState(s.id, now)?.max ?? null,
      };
    });
  };

  app.get('/api/game-news', admin, (_req, res) => {
    expireOld();
    const log = (db.prepare('SELECT * FROM game_news_log ORDER BY id DESC LIMIT 50').all() as LogRow[]).map((r) => ({
      id: r.id, serverId: r.server_id, serverName: r.server_name, text: r.text, status: r.status, error: r.error,
      sentBy: r.sent_by, sentAt: r.sent_at, deliveredAt: r.delivered_at,
    }));
    res.json({ servers: servers(), log, pluginLatest: PLUGIN_VERSION });
  });

  // a new token for the server's plugin: shown once, only the hash is stored (the old token stops working)
  app.post('/api/game-news/targets/:id/token', admin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM servers WHERE id = ?').get(id)) return res.status(404).json({ error: 'Сервер не найден' });
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare(
      `INSERT INTO game_news_targets (server_id, token_hash, last_seen, plugin_version) VALUES (?, ?, 0, '')
       ON CONFLICT(server_id) DO UPDATE SET token_hash = excluded.token_hash, last_seen = 0, plugin_version = ''`,
    ).run(id, sha256(token));
    res.json({ token });
  });

  app.delete('/api/game-news/targets/:id', admin, (req, res) => {
    db.prepare('DELETE FROM game_news_targets WHERE server_id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  app.post('/api/game-news/send', admin, (req, res) => {
    const b = sendSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Выберите сервер и введите текст' });
    const chk = checkNews(b.data.text);
    if (!chk.ok) return res.status(400).json({ error: chk.error });
    const now = Date.now();
    if (now - lastSend < MIN_GAP_MS) return res.status(429).json({ error: 'Слишком часто: подождите пару секунд' });
    lastSend = now;

    const results = queueNews(chk.text, b.data.serverIds, actor(req), now);
    res.json({ text: chk.text, results });
  });

  // ---- the administrator's own message templates ----
  const MAX_TEMPLATES = 30;
  app.get('/api/game-news/templates', admin, (_req, res) => {
    res.json(db.prepare('SELECT id, name, text FROM game_news_templates ORDER BY id').all());
  });
  app.post('/api/game-news/templates', admin, (req, res) => {
    const b = z.object({ name: z.string().trim().min(1, 'Введите название').max(40), text: z.string() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля' });
    const chk = checkNews(b.data.text);
    if (!chk.ok) return res.status(400).json({ error: chk.error });
    if ((db.prepare('SELECT COUNT(*) AS n FROM game_news_templates').get() as { n: number }).n >= MAX_TEMPLATES) return res.status(400).json({ error: `Не больше ${MAX_TEMPLATES} шаблонов` });
    const info = db.prepare('INSERT INTO game_news_templates (name, text, created_by, created_at) VALUES (?, ?, ?, ?)').run(b.data.name, chk.text, actor(req), Date.now());
    res.json({ id: Number(info.lastInsertRowid) });
  });
  app.delete('/api/game-news/templates/:id', admin, (req, res) => {
    db.prepare('DELETE FROM game_news_templates WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- for the game plugin: no session, a Bearer token of the server ----
  app.get('/api/game-news/pull', (req, res) => {
    const t = pluginTarget(req);
    if (!t) return res.status(401).json({ error: 'unauthorized' });

    const now = Date.now();
    if (now - (lastPull.get(t.server_id) ?? 0) < PULL_MIN_GAP_MS) return res.status(429).json({ error: 'too many requests' });
    lastPull.set(t.server_id, now);

    const version = String(req.headers['x-coregsm-version'] ?? '').replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 20);
    // what the plugin reports about its server (all optional: an older plugin sends nothing)
    const num = (h: string, max: number) => { const n = Number.parseInt(String(req.headers[h] ?? ''), 10); return Number.isFinite(n) && n >= 0 && n <= max ? n : -1; };
    let pname = '';
    try { pname = decodeURIComponent(String(req.headers['x-coregsm-name'] ?? '')).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60); } catch { pname = ''; }
    const players = num('x-coregsm-players', 10_000);
    const pmax = Math.max(0, num('x-coregsm-max', 10_000));
    db.prepare("UPDATE game_news_targets SET last_seen = ?, plugin_version = ?, plugin_name = CASE WHEN ? <> '' THEN ? ELSE plugin_name END, plugin_players = ?, plugin_max = CASE WHEN ? > 0 THEN ? ELSE plugin_max END WHERE server_id = ?")
      .run(now, version, pname, pname, players, pmax, pmax, t.server_id);

    expireOld(now);
    const rows = db.prepare("SELECT id, text FROM game_news_log WHERE server_id = ? AND status = 'queued' ORDER BY id LIMIT ?").all(t.server_id, PULL_BATCH) as { id: number; text: string }[];
    if (rows.length) {
      const done = db.prepare("UPDATE game_news_log SET status = 'delivered', ok = 1, delivered_at = ? WHERE id = ? AND status = 'queued'");
      db.transaction(() => { for (const r of rows) done.run(now, r.id); })();
    }
    // latest = the newest plugin version this panel knows (the plugin logs when it is older); welcome = the greeting for joining players
    res.json({ messages: rows.map((r) => ({ id: r.id, text: r.text })), latest: PLUGIN_VERSION, ...welcomeFor(t.server_id, now), ...joinLeaveFor(t.server_id), register: registerEnabled(t.server_id), chat: chatKindsConfigured(t.server_id), restart: consumeDue(t.server_id) });
  });
}
