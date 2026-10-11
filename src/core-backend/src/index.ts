import express, { type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db, getSetting, setSetting, type BindingRow, type ServerRow, type StatusRow } from './db.js';
import { refreshServer, startPoller } from './gsm.js';
import { renderCard } from './card.js';

const PORT = Number(process.env.PORT ?? 3000);
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? '';
const POLL_MS = Number(process.env.POLL_INTERVAL_SEC ?? 30) * 1000;
// one-time code that protects the first-run setup wizard from strangers who find the panel first
const SETUP_TOKEN = process.env.SETUP_TOKEN || crypto.randomBytes(8).toString('hex');

if (JWT_SECRET.length < 16 || INTERNAL_TOKEN.length < 16) {
  console.error('JWT_SECRET and INTERNAL_TOKEN must be set (min 16 chars)');
  process.exit(1);
}

const needsSetup = () => !db.prepare('SELECT 1 FROM users LIMIT 1').get();

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// optional first-start defaults from .env (the panel settings take over afterwards)
if (getSetting('discord_token') === null && process.env.DISCORD_TOKEN) setSetting('discord_token', process.env.DISCORD_TOKEN);
if (getSetting('proxy_url') === null && process.env.PROXY_URL) setSetting('proxy_url', process.env.PROXY_URL);

const PROXY_RE = /^(socks5h?|http|https):\/\/([^@/\s]+@)?[^@/:\s]+:\d{1,5}\/?$/;
const maskProxy = (u: string) => u.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@');

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

// ---------- first-run setup wizard ----------
app.get('/api/setup/status', (_req, res) => {
  res.json({ needed: needsSetup() });
});

const setupSchema = z.object({
  code: z.string().min(1).max(64),
  username: z.string().trim().regex(/^[a-zA-Z0-9_.-]{3,32}$/, 'Логин: 3-32 символа, буквы, цифры и _ . -'),
  password: z.string().min(10, 'Пароль должен быть не короче 10 символов').max(256),
  discordToken: z.string().trim().max(200).optional(),
  proxyUrl: z.string().trim().max(300).optional(),
});

app.post(
  '/api/setup',
  loginLimiter,
  wrap(async (req, res) => {
    if (!needsSetup()) return res.status(409).json({ error: 'Панель уже настроена. Войдите под своим логином.' });
    const b = setupSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля формы' });
    if (!safeEqual(b.data.code.trim(), SETUP_TOKEN)) return res.status(403).json({ error: 'Неверный код установки' });
    if (b.data.proxyUrl && !PROXY_RE.test(b.data.proxyUrl)) {
      return res.status(400).json({ error: 'Прокси: формат socks5://host:port или http://host:port' });
    }

    const hash = await bcrypt.hash(b.data.password, 12);
    let userId = 0;
    try {
      db.transaction(() => {
        // re-check inside the transaction so two concurrent requests cannot both create an admin
        if (!needsSetup()) throw new Error('already-setup');
        userId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(b.data.username, hash).lastInsertRowid);
        if (b.data.discordToken) setSetting('discord_token', b.data.discordToken);
        if (b.data.proxyUrl) setSetting('proxy_url', b.data.proxyUrl);
      })();
    } catch {
      return res.status(409).json({ error: 'Панель уже настроена. Войдите под своим логином.' });
    }
    attempts.delete(req.ip ?? 'x');
    console.log(`setup completed, admin "${b.data.username}" created`);
    const token = jwt.sign({ username: b.data.username }, JWT_SECRET, { subject: String(userId), expiresIn: '7d' });
    res.status(201).json({ token, username: b.data.username });
  }),
);

// ---------- bot settings (token, proxy) ----------
function settingsPayload() {
  const tok = getSetting('discord_token');
  const proxy = getSetting('proxy_url');
  return {
    discordTokenSet: !!tok,
    discordTokenHint: tok ? `…${tok.slice(-4)}` : null,
    proxyUrl: proxy ? maskProxy(proxy) : null,
  };
}

app.get('/api/settings', auth, (_req, res) => {
  res.json(settingsPayload());
});

// undefined = keep, empty string = clear
const settingsSchema = z.object({
  discordToken: z.string().trim().max(200).optional(),
  proxyUrl: z.string().trim().max(300).optional(),
});

app.put('/api/settings', auth, (req, res) => {
  const b = settingsSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Проверьте поля формы' });
  if (b.data.proxyUrl && !PROXY_RE.test(b.data.proxyUrl)) {
    return res.status(400).json({ error: 'Прокси: формат socks5://host:port или http://host:port (можно с логином и паролем)' });
  }
  if (b.data.discordToken !== undefined) setSetting('discord_token', b.data.discordToken);
  if (b.data.proxyUrl !== undefined) setSetting('proxy_url', b.data.proxyUrl);
  res.json(settingsPayload());
});

let botStatus: { state: 'idle' | 'connecting' | 'online' | 'error'; tag: string | null; error: string | null; updatedAt: number } = {
  state: 'idle',
  tag: null,
  error: null,
  updatedAt: 0,
};

app.get('/api/bot/status', auth, (_req, res) => {
  // a bot that stopped reporting is considered offline
  const stale = Date.now() - botStatus.updatedAt > 45_000;
  res.json(stale ? { ...botStatus, state: 'error', error: 'Бот не отвечает. Проверьте: docker compose logs bot' } : botStatus);
});

// ---------- updates ----------
// The container never touches Docker or the host. "Update" drops a request file into UPDATE_DIR (a bind mount);
// a root systemd path unit on the host notices it and runs `coregsm-update`, which reports progress in status.json.
const UPDATE_DIR = process.env.UPDATE_DIR ?? '';
const APP_VERSION = process.env.APP_VERSION ?? '';
const UPDATE_BASE = process.env.UPDATE_BASE_URL ?? 'https://raw.githubusercontent.com/RJ-Bond/CoreGSM/refs/heads/main';

let remote: { build: string | null; error: string | null; at: number } = { build: null, error: null, at: 0 };

async function checkRemote(force = false): Promise<void> {
  if (!force && Date.now() - remote.at < 5 * 60_000) return;
  try {
    const res = await fetch(`${UPDATE_BASE}/version.txt`, { signal: AbortSignal.timeout(8000), headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const m = /^build=([a-f0-9]{6,64})$/m.exec(await res.text());
    if (!m) throw new Error('некорректный version.txt');
    remote = { build: m[1], error: null, at: Date.now() };
  } catch (e) {
    remote = { build: remote.build, error: `Не удалось проверить обновления: ${(e as Error).message}`, at: Date.now() };
  }
}

function updateFile(name: string): string {
  return path.join(UPDATE_DIR, name);
}

function updatePayload() {
  let job: { state: string; message: string; time: number } | null = null;
  try {
    job = JSON.parse(fs.readFileSync(updateFile('status.json'), 'utf8'));
  } catch {
    /* no update has run yet */
  }
  const dirOk = !!UPDATE_DIR && fs.existsSync(UPDATE_DIR);
  return {
    current: APP_VERSION || null,
    latest: remote.build,
    available: !!(APP_VERSION && remote.build && APP_VERSION !== remote.build),
    checkedAt: remote.at || null,
    error: remote.error,
    canApply: dirOk,
    pending: dirOk && fs.existsSync(updateFile('request')),
    job,
  };
}

app.get(
  '/api/update/status',
  auth,
  wrap(async (_req, res) => {
    await checkRemote();
    res.json(updatePayload());
  }),
);

app.post(
  '/api/update/check',
  auth,
  wrap(async (_req, res) => {
    await checkRemote(true);
    res.json(updatePayload());
  }),
);

app.post('/api/update/apply', auth, (_req, res) => {
  const state = updatePayload();
  if (!state.canApply) return res.status(503).json({ error: 'Обновление из панели не настроено на сервере. Выполните: sudo coregsm-update' });
  if (state.job?.state === 'running') return res.status(409).json({ error: 'Обновление уже выполняется' });
  try {
    fs.writeFileSync(updateFile('request'), String(Date.now()));
  } catch {
    return res.status(500).json({ error: 'Не удалось создать запрос на обновление (нет прав на папку /app/update)' });
  }
  console.log('update requested from the panel');
  res.status(202).json(updatePayload());
});

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
  if (safeEqual(String(req.headers['x-internal-token'] ?? ''), INTERNAL_TOKEN)) return next();
  res.status(403).json({ error: 'forbidden' });
}

app.get('/internal/config', internal, (_req, res) => {
  res.json({ discordToken: getSetting('discord_token') ?? '', proxyUrl: getSetting('proxy_url') ?? '' });
});

app.post('/internal/bot-status', internal, (req, res) => {
  const b = z
    .object({
      state: z.enum(['idle', 'connecting', 'online', 'error']),
      tag: z.string().max(100).nullable().optional(),
      error: z.string().max(300).nullable().optional(),
    })
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'bad body' });
  botStatus = { state: b.data.state, tag: b.data.tag ?? null, error: b.data.error ?? null, updatedAt: Date.now() };
  res.json({ ok: true });
});

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
  if (needsSetup()) {
    console.log('First run: open the panel in a browser and create the administrator.');
    if (!process.env.SETUP_TOKEN) console.log(`Setup code: ${SETUP_TOKEN}`);
  }
  startPoller(POLL_MS);
});

