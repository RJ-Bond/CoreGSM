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
import { checkNews } from './gameNewsLogic.js';

export const QUEUE_TTL_MS = 5 * 60_000;
/** the plugin counts as «online» when it polled within this time */
export const ONLINE_MS = 30_000;
const PULL_MIN_GAP_MS = 800;
const PULL_BATCH = 5;
const MIN_GAP_MS = 2000;

interface TargetRow { server_id: number; token_hash: string; last_seen: number; plugin_version: string }
interface LogRow { id: number; server_id: number | null; server_name: string; text: string; status: string; error: string; sent_by: string; sent_at: number; delivered_at: number | null }

let lastSend = 0;
const lastPull = new Map<number, number>();

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const actor = (req: Request) => (req as Request & { user?: { username?: string } }).user?.username ?? '';
const serverLabel = (id: number) =>
  (db.prepare("SELECT COALESCE(NULLIF(name, ''), host || ':' || port) AS n FROM servers WHERE id = ?").get(id) as { n: string } | undefined)?.n ?? `#${id}`;

const sendSchema = z.object({
  serverIds: z.array(z.number().int().positive()).min(1).max(50),
  text: z.string(),
});

/** queued messages that waited too long stop being valid */
function expireOld(now = Date.now()): void {
  db.prepare("UPDATE game_news_log SET status = 'expired', error = 'Плагин не забрал сообщение за 5 минут' WHERE status = 'queued' AND sent_at < ?").run(now - QUEUE_TTL_MS);
}

export function registerGameNews({ app, admin }: { app: Express; admin: RequestHandler }): void {
  const servers = () => {
    const rows = db.prepare("SELECT id, COALESCE(NULLIF(name, ''), host || ':' || port) AS name, game FROM servers ORDER BY id").all() as { id: number; name: string; game: string }[];
    const targets = new Map((db.prepare('SELECT * FROM game_news_targets').all() as TargetRow[]).map((t) => [t.server_id, t]));
    const now = Date.now();
    return rows.map((s) => {
      const t = targets.get(s.id);
      return {
        id: s.id, name: s.name, game: s.game,
        hasToken: !!t?.token_hash,
        lastSeen: t?.last_seen || null,
        online: !!t && t.last_seen > 0 && now - t.last_seen < ONLINE_MS,
        pluginVersion: t?.plugin_version ?? '',
      };
    });
  };

  app.get('/api/game-news', admin, (_req, res) => {
    expireOld();
    const log = (db.prepare('SELECT * FROM game_news_log ORDER BY id DESC LIMIT 50').all() as LogRow[]).map((r) => ({
      id: r.id, serverId: r.server_id, serverName: r.server_name, text: r.text, status: r.status, error: r.error,
      sentBy: r.sent_by, sentAt: r.sent_at, deliveredAt: r.delivered_at,
    }));
    res.json({ servers: servers(), log });
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

    const insert = db.prepare('INSERT INTO game_news_log (server_id, server_name, text, ok, status, error, sent_by, sent_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)');
    const results: { serverId: number; serverName: string; queued: boolean; online: boolean; error: string }[] = [];
    db.transaction(() => {
      for (const id of [...new Set(b.data.serverIds)]) {
        const name = serverLabel(id);
        const t = db.prepare('SELECT * FROM game_news_targets WHERE server_id = ?').get(id) as TargetRow | undefined;
        if (!t?.token_hash) {
          const error = 'Для сервера не создан токен плагина';
          insert.run(id, name, chk.text, 'failed', error, actor(req), now);
          results.push({ serverId: id, serverName: name, queued: false, online: false, error });
          continue;
        }
        insert.run(id, name, chk.text, 'queued', '', actor(req), now);
        results.push({ serverId: id, serverName: name, queued: true, online: t.last_seen > 0 && now - t.last_seen < ONLINE_MS, error: '' });
      }
      db.prepare('DELETE FROM game_news_log WHERE id NOT IN (SELECT id FROM game_news_log ORDER BY id DESC LIMIT 500)').run();
    })();
    res.json({ text: chk.text, results });
  });

  // ---- for the game plugin: no session, a Bearer token of the server ----
  app.get('/api/game-news/pull', (req, res) => {
    const m = /^Bearer ([0-9a-f]{20,100})$/i.exec(String(req.headers.authorization ?? ''));
    if (!m) return res.status(401).json({ error: 'unauthorized' });
    const t = db.prepare('SELECT * FROM game_news_targets WHERE token_hash = ?').get(sha256(m[1])) as TargetRow | undefined;
    if (!t) return res.status(401).json({ error: 'unauthorized' });

    const now = Date.now();
    if (now - (lastPull.get(t.server_id) ?? 0) < PULL_MIN_GAP_MS) return res.status(429).json({ error: 'too many requests' });
    lastPull.set(t.server_id, now);

    const version = String(req.headers['x-coregsm-version'] ?? '').replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 20);
    db.prepare('UPDATE game_news_targets SET last_seen = ?, plugin_version = ? WHERE server_id = ?').run(now, version, t.server_id);

    expireOld(now);
    const rows = db.prepare("SELECT id, text FROM game_news_log WHERE server_id = ? AND status = 'queued' ORDER BY id LIMIT ?").all(t.server_id, PULL_BATCH) as { id: number; text: string }[];
    if (rows.length) {
      const done = db.prepare("UPDATE game_news_log SET status = 'delivered', ok = 1, delivered_at = ? WHERE id = ? AND status = 'queued'");
      db.transaction(() => { for (const r of rows) done.run(now, r.id); })();
    }
    res.json({ messages: rows.map((r) => ({ id: r.id, text: r.text })) });
  });
}
