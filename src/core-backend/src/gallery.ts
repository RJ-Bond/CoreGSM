/**
 * The screenshot gallery: signed-in players upload screenshots from the game, the staff approve them, the best ones
 * get a star and go to the top of the gallery.
 *
 * A picture is re-encoded as JPEG (the original never reaches other people): up to 1920 px wide for viewing and
 * 640 px for the grid, in <data dir>/gallery/<id>.jpg and <id>@s.jpg. Pictures of the staff are approved at once.
 *
 *   GET    /api/gallery                  approved pictures (?serverId, ?featured=1, ?limit)
 *   GET    /api/gallery/mine             the visitor's own pictures with their state
 *   POST   /api/gallery                  upload (raw image body; ?serverId, ?caption)
 *   GET    /api/gallery/queue            waiting and recent pictures (staff)
 *   PATCH  /api/gallery/:id              approve, reject, star (staff)
 *   DELETE /api/gallery/:id              delete (the author or the staff)
 *   GET    /api/gallery/img/:id.jpg      the picture (?s=1 the small one); waiting ones only for the author and staff
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import skia from 'skia-canvas';
import { z } from 'zod';
import { allow, auth, type AuthedRequest, can, loadUser, permsOf, rateLimit, viewer } from './auth.js';

const staff = allow('moderation');
import { db, EFFECTIVE_NAME } from './db.js';
import { param, wrap } from './http.js';

const { Canvas, loadImage } = skia;

export const router = express.Router();

const DIR = path.join(path.dirname(process.env.DB_PATH ?? './data/coregsm.db'), 'gallery');
fs.mkdirSync(DIR, { recursive: true });
const fileOf = (id: number, small = false) => path.join(DIR, `${Math.trunc(id)}${small ? '@s' : ''}.jpg`);

db.exec(`
CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
  caption TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  featured INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gallery_status ON gallery(status, created_at);
`);

/** pictures waiting for the staff, per author */
export const PENDING_MAX = 5;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

interface Row { id: number; user_id: number | null; server_id: number | null; caption: string; status: 'pending' | 'approved' | 'rejected'; featured: number; width: number; height: number; created_at: number; author: string | null; server_name: string | null }

const SELECT = `SELECT g.*, u.username AS author, (SELECT ${EFFECTIVE_NAME} FROM servers s LEFT JOIN status st ON st.server_id = s.id WHERE s.id = g.server_id) AS server_name
  FROM gallery g LEFT JOIN users u ON u.id = g.user_id`;
const out = (r: Row) => ({
  id: r.id,
  url: `/api/gallery/img/${r.id}.jpg`,
  thumb: `/api/gallery/img/${r.id}.jpg?s=1`,
  caption: r.caption,
  author: r.author,
  serverId: r.server_id,
  serverName: r.server_name,
  status: r.status,
  featured: !!r.featured,
  width: r.width,
  height: r.height,
  createdAt: r.created_at,
});

async function encode(img: Awaited<ReturnType<typeof loadImage>>, maxW: number): Promise<{ buf: Buffer; w: number; h: number }> {
  const k = Math.min(1, maxW / img.width);
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const canvas = new Canvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return { buf: await canvas.toBuffer('jpeg', { quality: 0.85 }), w, h };
}

router.get('/api/gallery', viewer, (req, res) => {
  const serverId = Number(req.query.serverId) || 0;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
  const rows = db
    .prepare(`${SELECT} WHERE g.status = 'approved' ${serverId ? 'AND g.server_id = ?' : ''} ${req.query.featured === '1' ? 'AND g.featured = 1' : ''} ORDER BY g.featured DESC, g.created_at DESC LIMIT ?`)
    .all(...(serverId ? [serverId] : []), limit) as Row[];
  res.json(rows.map(out));
});

router.get('/api/gallery/mine', auth, (req: AuthedRequest, res) => {
  res.json((db.prepare(`${SELECT} WHERE g.user_id = ? ORDER BY g.created_at DESC LIMIT 100`).all(req.user!.id) as Row[]).map(out));
});

router.post('/api/gallery', auth, rateLimit(20), express.raw({ type: TYPES, limit: '8mb' }), wrap(async (req: AuthedRequest, res) => {
  const q = z.object({ serverId: z.coerce.number().int().positive().optional(), caption: z.string().trim().max(140).default('') }).safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: 'Неверные данные' });
  if (q.data.serverId && !db.prepare('SELECT 1 FROM servers WHERE id = ?').get(q.data.serverId)) return res.status(404).json({ error: 'Сервер не найден' });
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'Нужна картинка PNG, JPG или WebP до 8 МБ' });
  const trusted = can(req, 'moderation');
  const waiting = (db.prepare("SELECT COUNT(*) AS n FROM gallery WHERE user_id = ? AND status = 'pending'").get(req.user!.id) as { n: number }).n;
  if (!trusted && waiting >= PENDING_MAX) return res.status(429).json({ error: 'У вас уже 5 скриншотов ждут проверки. Дождитесь, пока их посмотрят.' });
  let big: { buf: Buffer; w: number; h: number };
  let small: { buf: Buffer };
  try {
    const img = await loadImage(body);
    if (!img.width || !img.height || img.width > 12000 || img.height > 12000) throw new Error('size');
    big = await encode(img, 1920);
    small = await encode(img, 640);
  } catch {
    return res.status(400).json({ error: 'Не удалось прочитать картинку: выберите PNG, JPG или WebP' });
  }
  const id = Number(
    db
      .prepare('INSERT INTO gallery (user_id, server_id, caption, status, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(req.user!.id, q.data.serverId ?? null, q.data.caption, trusted ? 'approved' : 'pending', big.w, big.h, Date.now()).lastInsertRowid,
  );
  try {
    fs.writeFileSync(fileOf(id), big.buf, { mode: 0o644 });
    fs.writeFileSync(fileOf(id, true), small.buf, { mode: 0o644 });
  } catch (e) {
    // a full disk must not leave a picture row without files
    db.prepare('DELETE FROM gallery WHERE id = ?').run(id);
    fs.rmSync(fileOf(id), { force: true });
    throw e;
  }
  res.json(out(db.prepare(`${SELECT} WHERE g.id = ?`).get(id) as Row));
}));

router.get('/api/gallery/queue', staff, (_req, res) => {
  const rows = db.prepare(`${SELECT} ORDER BY g.status = 'pending' DESC, g.created_at DESC LIMIT 200`).all() as Row[];
  res.json(rows.map(out));
});

router.patch('/api/gallery/:id', param('id'), staff, (req, res) => {
  const b = z.object({ status: z.enum(['approved', 'rejected', 'pending']).optional(), featured: z.boolean().optional() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM gallery WHERE id = ?').get(id)) return res.status(404).json({ error: 'Не найдено' });
  if (b.data.status) db.prepare('UPDATE gallery SET status = ? WHERE id = ?').run(b.data.status, id);
  // only an approved picture can be starred
  if (b.data.featured !== undefined) db.prepare("UPDATE gallery SET featured = ? WHERE id = ? AND (status = 'approved' OR ? = 0)").run(b.data.featured ? 1 : 0, id, b.data.featured ? 1 : 0);
  if (b.data.status && b.data.status !== 'approved') db.prepare('UPDATE gallery SET featured = 0 WHERE id = ?').run(id);
  res.json(out(db.prepare(`${SELECT} WHERE g.id = ?`).get(id) as Row));
});

router.delete('/api/gallery/:id', param('id'), auth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT user_id FROM gallery WHERE id = ?').get(id) as { user_id: number | null } | undefined;
  if (!row) return res.status(404).json({ error: 'Не найдено' });
  if (row.user_id !== req.user!.id && !can(req, 'moderation')) return res.status(403).json({ error: 'Это действие доступно администратору и модератору' });
  db.prepare('DELETE FROM gallery WHERE id = ?').run(id);
  fs.rmSync(fileOf(id), { force: true });
  fs.rmSync(fileOf(id, true), { force: true });
  res.json({ ok: true });
});

router.get('/api/gallery/img/:file', (req, res) => {
  const m = /^(\d{1,9})\.jpg$/.exec(String(req.params.file));
  if (!m) return res.status(404).end();
  const id = Number(m[1]);
  const row = db.prepare('SELECT user_id, status FROM gallery WHERE id = ?').get(id) as { user_id: number | null; status: string } | undefined;
  if (!row) return res.status(404).end();
  if (row.status !== 'approved') {
    // a picture not approved yet: only its author and the staff see it
    const u = loadUser(req);
    if (!u || (u.id !== row.user_id && !permsOf(u).includes('moderation'))) return res.status(404).end();
  }
  const f = fileOf(id, req.query.s === '1');
  if (!fs.existsSync(f)) return res.status(404).end();
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': row.status === 'approved' ? 'public, max-age=86400' : 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(fs.readFileSync(f));
});
