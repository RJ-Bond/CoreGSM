/**
 * Game news: the panel writes a message and the CoreGSM game plugin (BepInEx, on the game server) shows it in the
 * in-game chat. Per server we keep the plugin address and its token; the token never leaves the backend.
 * The plugin speaks HTTP:  POST <url>/api/news  {"text": "..."}  with  Authorization: Bearer <token>,  GET <url>/health.
 */
import type { Express, Request, RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { checkNews, normalizePluginUrl } from './gameNewsLogic.js';

interface TargetRow { server_id: number; url: string; token: string }
interface LogRow { id: number; server_id: number | null; server_name: string; text: string; ok: number; error: string; sent_by: string; sent_at: number }

const SEND_TIMEOUT_MS = 8000;
const MIN_GAP_MS = 2000;
let lastSend = 0;

const actor = (req: Request) => (req as Request & { user?: { username?: string } }).user?.username ?? '';
const serverLabel = (id: number) =>
  (db.prepare("SELECT COALESCE(NULLIF(name, ''), host || ':' || port) AS n FROM servers WHERE id = ?").get(id) as { n: string } | undefined)?.n ?? `#${id}`;

const targetSchema = z.object({
  url: z.string().trim().max(300),
  // undefined = keep the saved token, '' = clear it
  token: z.string().trim().max(200).optional(),
});
const sendSchema = z.object({
  serverIds: z.array(z.number().int().positive()).min(1).max(50),
  text: z.string(),
});

async function callPlugin(t: TargetRow, path: string, init: { method: 'GET' | 'POST'; body?: string }): Promise<{ ok: boolean; status: number; error: string }> {
  try {
    const res = await fetch(`${t.url}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' },
      body: init.body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      redirect: 'error',
    });
    if (res.ok) return { ok: true, status: res.status, error: '' };
    const map: Record<number, string> = { 401: 'Плагин не принял токен', 404: 'Плагин не найден по этому адресу', 413: 'Плагин отклонил слишком длинный текст', 429: 'Слишком часто: подождите пару секунд' };
    return { ok: false, status: res.status, error: map[res.status] ?? `Плагин ответил кодом ${res.status}` };
  } catch (e) {
    const name = (e as Error).name;
    return { ok: false, status: 0, error: name === 'TimeoutError' ? 'Плагин не ответил за 8 секунд' : 'Не удалось подключиться к плагину (адрес, порт, фаервол)' };
  }
}

export function registerGameNews({ app, admin }: { app: Express; admin: RequestHandler }): void {
  const serialize = () => {
    const servers = db.prepare("SELECT id, COALESCE(NULLIF(name, ''), host || ':' || port) AS name, game FROM servers ORDER BY id").all() as { id: number; name: string; game: string }[];
    const targets = new Map((db.prepare('SELECT * FROM game_news_targets').all() as TargetRow[]).map((t) => [t.server_id, t]));
    return servers.map((s) => ({ id: s.id, name: s.name, game: s.game, url: targets.get(s.id)?.url ?? '', hasToken: !!targets.get(s.id)?.token }));
  };

  app.get('/api/game-news', admin, (_req, res) => {
    const log = (db.prepare('SELECT * FROM game_news_log ORDER BY id DESC LIMIT 50').all() as LogRow[]).map((r) => ({
      id: r.id, serverId: r.server_id, serverName: r.server_name, text: r.text, ok: !!r.ok, error: r.error, sentBy: r.sent_by, sentAt: r.sent_at,
    }));
    res.json({ servers: serialize(), log });
  });

  app.put('/api/game-news/targets/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM servers WHERE id = ?').get(id)) return res.status(404).json({ error: 'Сервер не найден' });
    const b = targetSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    const url = normalizePluginUrl(b.data.url);
    if (!url) return res.status(400).json({ error: 'Адрес плагина: http://адрес:порт (без логина и пути)' });
    const old = db.prepare('SELECT token FROM game_news_targets WHERE server_id = ?').get(id) as { token: string } | undefined;
    const token = b.data.token === undefined ? old?.token ?? '' : b.data.token;
    db.prepare(
      'INSERT INTO game_news_targets (server_id, url, token) VALUES (?, ?, ?) ON CONFLICT(server_id) DO UPDATE SET url = excluded.url, token = excluded.token',
    ).run(id, url, token);
    res.json({ ok: true });
  });

  app.delete('/api/game-news/targets/:id', admin, (req, res) => {
    db.prepare('DELETE FROM game_news_targets WHERE server_id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // «Проверить связь»: the plugin's /health
  app.post('/api/game-news/check/:id', admin, async (req, res) => {
    const t = db.prepare('SELECT * FROM game_news_targets WHERE server_id = ?').get(Number(req.params.id)) as TargetRow | undefined;
    if (!t || !t.url) return res.status(400).json({ error: 'Сначала укажите адрес плагина' });
    const r = await callPlugin(t, '/health', { method: 'GET' });
    res.json({ ok: r.ok, error: r.error });
  });

  app.post('/api/game-news/send', admin, async (req, res) => {
    const b = sendSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Выберите сервер и введите текст' });
    const chk = checkNews(b.data.text);
    if (!chk.ok) return res.status(400).json({ error: chk.error });
    const now = Date.now();
    if (now - lastSend < MIN_GAP_MS) return res.status(429).json({ error: 'Слишком часто: подождите пару секунд' });
    lastSend = now;

    const results: { serverId: number; serverName: string; ok: boolean; error: string }[] = [];
    for (const id of [...new Set(b.data.serverIds)]) {
      const name = serverLabel(id);
      const t = db.prepare('SELECT * FROM game_news_targets WHERE server_id = ?').get(id) as TargetRow | undefined;
      let r: { ok: boolean; error: string };
      if (!t || !t.url || !t.token) r = { ok: false, error: 'Для сервера не настроен плагин (адрес и токен)' };
      else r = await callPlugin(t, '/api/news', { method: 'POST', body: JSON.stringify({ text: chk.text }) });
      db.prepare('INSERT INTO game_news_log (server_id, server_name, text, ok, error, sent_by, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, name, chk.text, r.ok ? 1 : 0, r.error, actor(req), Date.now());
      results.push({ serverId: id, serverName: name, ok: r.ok, error: r.error });
    }
    db.prepare('DELETE FROM game_news_log WHERE id NOT IN (SELECT id FROM game_news_log ORDER BY id DESC LIMIT 500)').run();
    res.json({ text: chk.text, results });
  });
}
