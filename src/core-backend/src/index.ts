import express, { type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db, type BindingRow, type ServerRow, type StatusRow } from './db.js';
import { refreshServer, startPoller } from './gsm.js';
import { renderCard } from './card.js';

const PORT = Number(process.env.PORT ?? 3000);
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const POLL_MS = Number(process.env.POLL_INTERVAL_SEC ?? 30) * 1000;

if (JWT_SECRET.length < 16 || INTERNAL_TOKEN.length < 16) {
  console.error('JWT_SECRET and INTERNAL_TOKEN must be set (min 16 chars)');
  process.exit(1);
}

// admin account is created once; later password changes are kept
if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get('admin')) {
  if (!ADMIN_PASSWORD) {
    console.error('ADMIN_PASSWORD is required for first start');
    process.exit(1);
  }
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', bcrypt.hashSync(ADMIN_PASSWORD, 12));
  console.log('admin user created');
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));

const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

// ---------- auth ----------
interface AuthedRequest extends Request {
  user?: { id: number; username: string };
}

function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  try {
    const p = jwt.verify(token, JWT_SECRET) as { sub: string; username: string };
    req.user = { id: Number(p.sub), username: p.username };
    next();
  } catch {
    res.status(401).json({ error: 'Требуется вход' });
  }
}

const attempts = new Map<string, { n: number; reset: number }>();
function loginLimiter(req: Request, res: Response, next: NextFunction) {
  const key = req.ip ?? 'x';
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.reset > now && a.n >= 10) {
    res.status(429).json({ error: 'Слишком много попыток. Подождите 10 минут.' });
    return;
  }
  if (!a || a.reset <= now) attempts.set(key, { n: 1, reset: now + 10 * 60 * 1000 });
  else a.n++;
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post(
  '/api/auth/login',
  loginLimiter,
  wrap(async (req, res) => {
    const body = z.object({ username: z.string().max(64), password: z.string().max(256) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Неверные данные' });
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(body.data.username) as
      | { id: number; username: string; password_hash: string }
      | undefined;
    const ok = await bcrypt.compare(body.data.password, u?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi');
    if (!u || !ok) return res.status(401).json({ error: 'Неверный логин или пароль' });
    attempts.delete(req.ip ?? 'x');
    const token = jwt.sign({ username: u.username }, JWT_SECRET, { subject: String(u.id), expiresIn: '7d' });
    res.json({ token, username: u.username });
  }),
);

app.get('/api/me', auth, (req: AuthedRequest, res) => {
  res.json({ username: req.user!.username });
});

app.post(
  '/api/auth/password',
  auth,
  wrap(async (req: AuthedRequest, res) => {
    const body = z.object({ current: z.string(), next: z.string().min(10).max(256) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Новый пароль должен быть не короче 10 символов' });
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string };
    if (!(await bcrypt.compare(body.data.current, u.password_hash))) {
      return res.status(403).json({ error: 'Текущий пароль неверен' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(body.data.next, 12), req.user!.id);
    res.json({ ok: true });
  }),
);

// ---------- servers ----------
const serverSchema = z.object({
  name: z.string().trim().min(1).max(64),
  game: z.string().trim().min(1).max(32).regex(/^[a-z0-9_]+$/i),
  host: z.string().trim().min(1).max(255).regex(/^[a-z0-9.\-:]+$/i),
  port: z.number().int().min(1).max(65535),
  queryPort: z.number().int().min(1).max(65535).nullable().optional(),
});

type ServerJoin = ServerRow & Partial<Omit<StatusRow, 'server_id'>> & { has_status: number | null };

function serialize(r: ServerJoin) {
  return {
    id: r.id,
    name: r.name,
    game: r.game,
    host: r.host,
    port: r.port,
    queryPort: r.query_port,
    hasStatus: r.has_status != null,
    online: !!r.online,
    players: r.players ?? 0,
    maxPlayers: r.max_players ?? 0,
    map: r.map ?? null,
    version: r.version ?? null,
    ping: r.ping ?? null,
    playerNames: r.player_names ? (JSON.parse(r.player_names) as string[]) : [],
    error: r.error ?? null,
    updatedAt: r.updated_at ?? null,
  };
}

const SELECT_SERVERS = `
SELECT s.*, st.online, st.players, st.max_players, st.map, st.version, st.ping, st.player_names, st.error,
       st.updated_at, st.server_id AS has_status
FROM servers s LEFT JOIN status st ON st.server_id = s.id`;

function getServer(id: number) {
  const row = db.prepare(`${SELECT_SERVERS} WHERE s.id = ?`).get(id) as ServerJoin | undefined;
  return row ? serialize(row) : null;
}

app.get('/api/servers', auth, (_req, res) => {
  const rows = db.prepare(`${SELECT_SERVERS} ORDER BY s.id`).all() as ServerJoin[];
  res.json(rows.map(serialize));
});

app.post(
  '/api/servers',
  auth,
  wrap(async (req, res) => {
    const b = serverSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля формы' });
    const info = db
      .prepare('INSERT INTO servers (name, game, host, port, query_port, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(b.data.name, b.data.game, b.data.host, b.data.port, b.data.queryPort ?? null, Date.now());
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(info.lastInsertRowid) as ServerRow;
    await refreshServer(row);
    res.status(201).json(getServer(row.id));
  }),
);

app.put(
  '/api/servers/:id',
  auth,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const b = serverSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля формы' });
    const r = db
      .prepare('UPDATE servers SET name=?, game=?, host=?, port=?, query_port=? WHERE id=?')
      .run(b.data.name, b.data.game, b.data.host, b.data.port, b.data.queryPort ?? null, id);
    if (!r.changes) return res.status(404).json({ error: 'Сервер не найден' });
    await refreshServer(db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as ServerRow);
    res.json(getServer(id));
  }),
);

app.delete('/api/servers/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM servers WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Сервер не найден' });
  res.json({ ok: true });
});

app.post(
  '/api/servers/:id/refresh',
  auth,
  wrap(async (req, res) => {
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(Number(req.params.id)) as ServerRow | undefined;
    if (!row) return res.status(404).json({ error: 'Сервер не найден' });
    await refreshServer(row);
    res.json(getServer(row.id));
  }),
);

app.get('/api/servers/:id/history', auth, (req, res) => {
  const hours = Math.min(168, Math.max(1, Number(req.query.hours ?? 24)));
  const rows = db
    .prepare('SELECT ts, online, players FROM history WHERE server_id = ? AND ts > ? ORDER BY ts')
    .all(Number(req.params.id), Date.now() - hours * 3600 * 1000);
  res.json(rows);
});

// public PNG card (used by Discord bot and for sharing)
app.get(
  '/api/card/:id(\\d+).png',
  wrap(async (req, res) => {
    const buf = await renderCard(Number(req.params.id));
    if (!buf) return res.status(404).json({ error: 'Сервер не найден' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }).send(buf);
  }),
);

// ---------- discord bindings ----------
const bindingSchema = z.object({
  serverId: z.number().int(),
  channelId: z.string().regex(/^\d{15,25}$/, 'ID канала — число из 15–25 цифр'),
  intervalSec: z.number().int().min(30).max(3600).default(60),
  enabled: z.boolean().default(true),
});

const serializeBinding = (b: BindingRow) => ({
  id: b.id,
  serverId: b.server_id,
  channelId: b.channel_id,
  messageId: b.message_id,
  intervalSec: b.interval_sec,
  enabled: !!b.enabled,
  lastUpdate: b.last_update,
  lastError: b.last_error,
});

app.get('/api/bindings', auth, (_req, res) => {
  res.json((db.prepare('SELECT * FROM bindings ORDER BY id').all() as BindingRow[]).map(serializeBinding));
});

app.post('/api/bindings', auth, (req, res) => {
  const b = bindingSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Неверные данные' });
  if (!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(b.data.serverId)) {
    return res.status(400).json({ error: 'Сервер не найден' });
  }
  const info = db
    .prepare('INSERT INTO bindings (server_id, channel_id, interval_sec, enabled) VALUES (?, ?, ?, ?)')
    .run(b.data.serverId, b.data.channelId, b.data.intervalSec, b.data.enabled ? 1 : 0);
  res.status(201).json(serializeBinding(db.prepare('SELECT * FROM bindings WHERE id = ?').get(info.lastInsertRowid) as BindingRow));
});

app.put('/api/bindings/:id', auth, (req, res) => {
  const b = bindingSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Неверные данные' });
  const id = Number(req.params.id);
  const old = db.prepare('SELECT * FROM bindings WHERE id = ?').get(id) as BindingRow | undefined;
  if (!old) return res.status(404).json({ error: 'Не найдено' });
  // moving to another channel/server means a new message must be posted
  const resetMsg = old.channel_id !== b.data.channelId || old.server_id !== b.data.serverId;
  db.prepare(
    'UPDATE bindings SET server_id=?, channel_id=?, interval_sec=?, enabled=?, message_id=CASE WHEN ? THEN NULL ELSE message_id END WHERE id=?',
  ).run(b.data.serverId, b.data.channelId, b.data.intervalSec, b.data.enabled ? 1 : 0, resetMsg ? 1 : 0, id);
  res.json(serializeBinding(db.prepare('SELECT * FROM bindings WHERE id = ?').get(id) as BindingRow));
});

app.delete('/api/bindings/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM bindings WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ---------- internal (bot only, not exposed by nginx) ----------
function internal(req: Request, res: Response, next: NextFunction) {
  const given = Buffer.from(String(req.headers['x-internal-token'] ?? ''));
  const want = Buffer.from(INTERNAL_TOKEN);
  if (given.length === want.length && crypto.timingSafeEqual(given, want)) return next();
  res.status(403).json({ error: 'forbidden' });
}

app.get('/internal/bindings', internal, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT b.*, s.name AS server_name FROM bindings b JOIN servers s ON s.id = b.server_id WHERE b.enabled = 1`,
    )
    .all() as (BindingRow & { server_name: string })[];
  res.json(rows.map((r) => ({ ...serializeBinding(r), serverName: r.server_name })));
});

app.patch('/internal/bindings/:id', internal, (req, res) => {
  const b = z
    .object({ messageId: z.string().nullable().optional(), error: z.string().max(300).nullable().optional() })
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'bad body' });
  const id = Number(req.params.id);
  if (b.data.messageId !== undefined) db.prepare('UPDATE bindings SET message_id = ? WHERE id = ?').run(b.data.messageId, id);
  db.prepare('UPDATE bindings SET last_update = ?, last_error = ? WHERE id = ?').run(Date.now(), b.data.error ?? null, id);
  res.json({ ok: true });
});

// ---------- errors ----------
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  console.log(`CoreGSM backend listening on :${PORT}`);
  startPoller(POLL_MS);
});

