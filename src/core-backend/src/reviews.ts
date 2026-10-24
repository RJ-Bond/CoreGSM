/**
 * Reviews of the servers: a signed-in user gives 1–5 stars and a few words, one review per server (editing replaces
 * it). A review is shown at once; the staff can hide or delete it.
 *   GET    /api/servers/:id/reviews        the average, the spread of stars, the shown reviews and the visitor's own
 *   PUT    /api/servers/:id/reviews        write or edit one's own review
 *   DELETE /api/servers/:id/reviews/mine   remove one's own review
 *   GET    /api/reviews                    the latest reviews of all servers, hidden ones included (staff)
 *   PATCH  /api/reviews/:id                hide or show (staff)
 *   DELETE /api/reviews/:id                delete (staff)
 */
import express from 'express';
import { z } from 'zod';
import { allow, auth, type AuthedRequest, rateLimit, viewer } from './auth.js';

const staff = allow('moderation');
import { db, EFFECTIVE_NAME } from './db.js';
import { param } from './http.js';

export const router = express.Router();

db.exec(`
CREATE TABLE IF NOT EXISTS server_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (server_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_server ON server_reviews(server_id, hidden);
`);

interface Row { id: number; server_id: number; user_id: number; stars: number; text: string; hidden: number; created_at: number; updated_at: number; username: string; discord_id: string | null; discord_avatar: string | null }

const SELECT = `SELECT r.*, u.username, u.discord_id, u.discord_avatar FROM server_reviews r JOIN users u ON u.id = r.user_id`;
const avatar = (r: Row) => (r.discord_id && r.discord_avatar ? `https://cdn.discordapp.com/avatars/${r.discord_id}/${r.discord_avatar}.png?size=64` : null);
const out = (r: Row) => ({ id: r.id, serverId: r.server_id, author: r.username, avatarUrl: avatar(r), stars: r.stars, text: r.text, hidden: !!r.hidden, createdAt: r.created_at, updatedAt: r.updated_at });

/** the score of a server: the average of the shown reviews and how many gave each number of stars */
export function scoreOf(serverId: number): { avg: number | null; count: number; dist: number[] } {
  const rows = db.prepare('SELECT stars, COUNT(*) AS n FROM server_reviews WHERE server_id = ? AND hidden = 0 GROUP BY stars').all(serverId) as { stars: number; n: number }[];
  const dist = [0, 0, 0, 0, 0];
  for (const r of rows) dist[r.stars - 1] = r.n;
  const count = dist.reduce((a, b) => a + b, 0);
  const avg = count ? Math.round((dist.reduce((a, n, i) => a + n * (i + 1), 0) / count) * 10) / 10 : null;
  return { avg, count, dist };
}

const serverExists = (id: number) => Number.isInteger(id) && !!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(id);

router.get('/api/servers/:id/reviews', param('id'), viewer, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!serverExists(id)) return res.status(404).json({ error: 'Сервер не найден' });
  const items = (db.prepare(`${SELECT} WHERE r.server_id = ? AND r.hidden = 0 ORDER BY r.updated_at DESC LIMIT 50`).all(id) as Row[]).map(out);
  const mine = req.user ? (db.prepare(`${SELECT} WHERE r.server_id = ? AND r.user_id = ?`).get(id, req.user.id) as Row | undefined) : undefined;
  res.json({ ...scoreOf(id), items, mine: mine ? out(mine) : null });
});

router.put('/api/servers/:id/reviews', param('id'), auth, rateLimit(20), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!serverExists(id)) return res.status(404).json({ error: 'Сервер не найден' });
  const b = z.object({ stars: z.number().int().min(1).max(5), text: z.string().trim().max(1000).default('') }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  const now = Date.now();
  // editing keeps a hidden review hidden: the staff decided, not the author
  db.prepare(
    `INSERT INTO server_reviews (server_id, user_id, stars, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id, user_id) DO UPDATE SET stars = excluded.stars, text = excluded.text, updated_at = excluded.updated_at`,
  ).run(id, req.user!.id, b.data.stars, b.data.text, now, now);
  const mine = db.prepare(`${SELECT} WHERE r.server_id = ? AND r.user_id = ?`).get(id, req.user!.id) as Row;
  res.json({ ...scoreOf(id), mine: out(mine) });
});

router.delete('/api/servers/:id/reviews/mine', param('id'), auth, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM server_reviews WHERE server_id = ? AND user_id = ?').run(Number(req.params.id), req.user!.id);
  res.json({ ok: true });
});

router.get('/api/reviews', staff, (_req, res) => {
  const rows = db
    .prepare(`SELECT r.*, u.username, u.discord_id, u.discord_avatar, ${EFFECTIVE_NAME} AS server_name FROM server_reviews r JOIN users u ON u.id = r.user_id JOIN servers s ON s.id = r.server_id LEFT JOIN status st ON st.server_id = s.id ORDER BY r.updated_at DESC LIMIT 200`)
    .all() as (Row & { server_name: string })[];
  res.json(rows.map((r) => ({ ...out(r), serverName: r.server_name })));
});

router.patch('/api/reviews/:id', param('id'), staff, (req, res) => {
  const b = z.object({ hidden: z.boolean() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  const r = db.prepare('UPDATE server_reviews SET hidden = ? WHERE id = ?').run(b.data.hidden ? 1 : 0, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

router.delete('/api/reviews/:id', param('id'), staff, (req, res) => {
  db.prepare('DELETE FROM server_reviews WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
