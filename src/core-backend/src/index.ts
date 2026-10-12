import express, { type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db, EFFECTIVE_NAME, getSetting, setSetting, type BindingRow, type ServerRow, type StatusRow } from './db.js';
import { queryServer, refreshServer, startPoller } from './gsm.js';
import { renderCard, renderGameIcon } from './card.js';
import { buildEmbed } from './embed.js';
import { registerNews } from './news.js';
import { installAudit, registerOps } from './ops.js';
import { registerAlerts } from './alerts.js';
import { countryLabel, countryOf } from './geo.js';

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

type ProxyType = 'socks5' | 'http';

/**
 * Accepts what proxy sellers usually hand out and turns it into a URL:
 *   socks5://user:pass@host:port   (kept as is)
 *   host:port:user:pass            (the password may contain ":")
 *   user:pass@host:port
 *   host:port
 * The scheme comes from `type` when the text has none. Credentials are percent-encoded.
 */
function normalizeProxy(raw: string, type: ProxyType): string {
  const v = raw.trim();
  if (!v || /^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
  let host = '';
  let port = '';
  let user: string | undefined;
  let pass: string | undefined;
  const at = v.lastIndexOf('@');
  // "host:port:user:pass" is recognised first: the password itself may contain "@" or ":"
  if (/^[^@:\s]+:\d{1,5}:[^\s]+$/.test(v)) {
    const p = v.split(':');
    [host, port, user] = p;
    pass = p.slice(3).join(':');
  } else if (at > 0) {
    const cred = v.slice(0, at);
    const ci = cred.indexOf(':');
    user = ci < 0 ? cred : cred.slice(0, ci);
    pass = ci < 0 ? undefined : cred.slice(ci + 1);
    [host, port] = v.slice(at + 1).split(':');
  } else {
    const p = v.split(':');
    if (p.length === 2) [host, port] = p;
    else if (p.length >= 4) {
      [host, port, user] = p;
      pass = p.slice(3).join(':');
    } else return v;
  }
  const auth = user ? `${encodeURIComponent(user)}${pass !== undefined ? ':' + encodeURIComponent(pass) : ''}@` : '';
  return `${type}://${auth}${host}:${port}`;
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use('/internal/bot-guilds', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '50kb' }));
installAudit(app);

const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

// ---------- auth ----------
type Role = 'admin' | 'player';
interface AuthedRequest extends Request {
  user?: { id: number; username: string; role: Role; sid?: string };
}

/** The signed-in user (checked against the database, so a deleted or demoted account loses access at once). */
function userFromToken(token: string): { id: number; username: string; role: Role; sid: string } | null {
  if (!token) return null;
  try {
    const p = jwt.verify(token, JWT_SECRET) as { sub: string; sid?: string };
    // a token without a session id predates sessions: sign in again
    if (!p.sid) return null;
    const u = db.prepare("SELECT id, username, role FROM users WHERE id = ? AND status = 'active'").get(Number(p.sub)) as { id: number; username: string; role: Role } | undefined;
    if (!u) return null;
    // an ended session (revoked from the profile) stops working at once
    if (!db.prepare('SELECT 1 FROM sessions WHERE id = ? AND user_id = ?').get(p.sid, u.id)) return null;
    const now = Date.now();
    if (now - (lastSeen.get(p.sid) ?? 0) > 60_000) {
      lastSeen.set(p.sid, now);
      db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now, p.sid);
    }
    return { ...u, sid: p.sid };
  } catch {
    return null;
  }
}
const lastSeen = new Map<string, number>();

function loadUser(req: Request) {
  const h = req.headers.authorization ?? '';
  return userFromToken(h.startsWith('Bearer ') ? h.slice(7) : '');
}

/** "Chrome · Windows" from a User-Agent string */
function uaLabel(ua: string | undefined): string {
  const s = ua ?? '';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Браузер';
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad|iOS/.test(s) ? 'iOS' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

/** Starts a session and returns the signed token for it. */
function issueToken(u: { id: number; username: string }, req: Request): string {
  const sid = crypto.randomBytes(12).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen, ip, ua) VALUES (?, ?, ?, ?, ?, ?)').run(sid, u.id, now, now, (req.ip ?? '').slice(0, 64), uaLabel(req.headers['user-agent']));
  return jwt.sign({ username: u.username, sid }, JWT_SECRET, { subject: String(u.id), expiresIn: '7d' });
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - 8 * 24 * 3600 * 1000), 3600_000).unref();

const isAdmin = (req: Request) => (req as AuthedRequest).user?.role === 'admin';
const flag = (key: string, fallback: boolean) => {
  const v = getSetting(key);
  return v === null ? fallback : v === '1';
};
const publicPanel = () => flag('public_panel', true);
const registrationOpen = () => flag('registration_open', true);

/** any signed-in user */
function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const u = loadUser(req);
  if (!u) return void res.status(401).json({ error: 'Требуется вход' });
  req.user = u;
  next();
}
/** administrators only */
function admin(req: AuthedRequest, res: Response, next: NextFunction) {
  const u = loadUser(req);
  if (!u) return void res.status(401).json({ error: 'Требуется вход' });
  if (u.role !== 'admin') return void res.status(403).json({ error: 'Это действие доступно только администратору' });
  req.user = u;
  next();
}
/** viewing: open to everyone while the panel is public, otherwise requires a sign-in */
function viewer(req: AuthedRequest, res: Response, next: NextFunction) {
  const u = loadUser(req);
  if (u) req.user = u;
  if (!u && !publicPanel()) return void res.status(401).json({ error: 'Требуется вход' });
  next();
}

const LOCK_AFTER = 5;
const fails = new Map<string, { n: number; until: number }>();
setInterval(() => { for (const [k, v] of fails) if (v.until < Date.now() - 3600_000) fails.delete(k); }, 600_000).unref();

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
    const body = z.object({ username: z.string().trim().max(64), password: z.string().max(256) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Неверные данные' });
    // lock out after repeated wrong passwords for the same login from the same address
    const key = `${req.ip ?? 'x'}|${body.data.username.toLowerCase()}`;
    const lock = fails.get(key);
    if (lock && lock.until > Date.now()) {
      const retryAfter = Math.ceil((lock.until - Date.now()) / 1000);
      return res.status(429).json({ error: `Слишком много неверных попыток. Повторите через ${retryAfter} с.`, retryAfter });
    }
    const u = db.prepare('SELECT * FROM users WHERE ulower(username) = ?').get(body.data.username.toLowerCase()) as
      | { id: number; username: string; password_hash: string; role: Role; status: string }
      | undefined;
    const ok = await bcrypt.compare(body.data.password, u?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi');
    if (!u || !ok) {
      const f = fails.get(key) ?? { n: 0, until: 0 };
      f.n++;
      if (f.n >= LOCK_AFTER) f.until = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (f.n - LOCK_AFTER));
      fails.set(key, f);
      const attemptsLeft = Math.max(0, LOCK_AFTER - f.n);
      return res.status(401).json({ error: 'Неверный логин или пароль', attemptsLeft: f.n >= LOCK_AFTER ? 0 : attemptsLeft });
    }
    fails.delete(key);
    if (u.status !== 'active') return res.status(403).json({ error: 'Заявка на регистрацию ещё не одобрена администратором', pending: true });
    attempts.delete(req.ip ?? 'x');
    res.json({ token: issueToken(u, req), username: u.username, role: u.role });
  }),
);

// ---------- first-run setup wizard ----------
app.get('/api/setup/status', (_req, res) => {
  res.json({ needed: needsSetup() });
});

const setupSchema = z.object({
  code: z.string().min(1).max(64),
  // letters (any alphabet), digits, _ . - and single spaces between words; 3-32 characters
  username: z
    .string()
    .trim()
    .regex(/^(?=.{3,32}$)[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u, 'Логин: 3-32 символа: буквы, цифры, пробел между словами, _ . -'),
  password: z.string().min(10, 'Пароль должен быть не короче 10 символов').max(256),
  discordToken: z.string().trim().max(200).optional(),
  proxyUrl: z.string().trim().max(300).optional(),
  proxyType: z.enum(['socks5', 'http']).optional(),
});

const PROXY_HELP = 'Прокси: host:port:логин:пароль, socks5://логин:пароль@host:port или http://host:port';

app.post(
  '/api/setup',
  loginLimiter,
  wrap(async (req, res) => {
    if (!needsSetup()) return res.status(409).json({ error: 'Панель уже настроена. Войдите под своим логином.' });
    const b = setupSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля формы' });
    if (!safeEqual(b.data.code.trim(), SETUP_TOKEN)) return res.status(403).json({ error: 'Неверный код установки' });
    const proxyUrl = normalizeProxy(b.data.proxyUrl ?? '', b.data.proxyType ?? 'socks5');
    if (proxyUrl && !PROXY_RE.test(proxyUrl)) return res.status(400).json({ error: PROXY_HELP });

    const hash = await bcrypt.hash(b.data.password, 12);
    let userId = 0;
    try {
      db.transaction(() => {
        // re-check inside the transaction so two concurrent requests cannot both create an admin
        if (!needsSetup()) throw new Error('already-setup');
        userId = Number(db.prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)").run(b.data.username, hash, Date.now()).lastInsertRowid);
        if (b.data.discordToken) setSetting('discord_token', b.data.discordToken);
        if (proxyUrl) setSetting('proxy_url', proxyUrl);
      })();
    } catch {
      return res.status(409).json({ error: 'Панель уже настроена. Войдите под своим логином.' });
    }
    attempts.delete(req.ip ?? 'x');
    console.log(`setup completed, admin "${b.data.username}" created`);
    const token = issueToken({ id: userId, username: b.data.username }, req);
    res.status(201).json({ token, username: b.data.username, role: 'admin' });
  }),
);

// ---------- bot settings (token, proxy) ----------
function settingsPayload(req?: Request) {
  const tok = getSetting('discord_token');
  const proxy = getSetting('proxy_url');
  return {
    discordTokenSet: !!tok,
    discordTokenHint: tok ? `…${tok.slice(-4)}` : null,
    proxyUrl: proxy ? maskProxy(proxy) : null,
    discordSecretSet: !!getSetting('discord_client_secret'),
    discordClientId: botStatus.clientId ?? clientIdFromToken(tok),
    discordRedirect: req ? `${req.protocol}://${req.get('host')}/api/auth/discord/callback` : '',
  };
}

app.get('/api/settings', admin, (req, res) => {
  res.json(settingsPayload(req));
});

// undefined = keep, empty string = clear
const settingsSchema = z.object({
  discordToken: z.string().trim().max(200).optional(),
  proxyUrl: z.string().trim().max(300).optional(),
  proxyType: z.enum(['socks5', 'http']).optional(),
  discordClientSecret: z.string().trim().max(200).optional(),
});

app.put('/api/settings', admin, (req, res) => {
  const b = settingsSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Проверьте поля формы' });
  const proxyUrl = b.data.proxyUrl === undefined ? undefined : normalizeProxy(b.data.proxyUrl, b.data.proxyType ?? 'socks5');
  if (proxyUrl && !PROXY_RE.test(proxyUrl)) return res.status(400).json({ error: PROXY_HELP });
  if (b.data.discordToken !== undefined) setSetting('discord_token', b.data.discordToken);
  if (proxyUrl !== undefined) setSetting('proxy_url', proxyUrl);
  if (b.data.discordClientSecret !== undefined) setSetting('discord_client_secret', b.data.discordClientSecret);
  res.json(settingsPayload(req));
});

let botStatus: {
  state: 'idle' | 'connecting' | 'online' | 'error';
  tag: string | null;
  clientId: string | null;
  error: string | null;
  updatedAt: number;
} = {
  state: 'idle',
  tag: null,
  clientId: null,
  error: null,
  updatedAt: 0,
};

// View Channel + Send Messages + Embed Links + Attach Files
const BOT_PERMISSIONS = 52224;

/** The first segment of a bot token is the base64 of the bot user id (= application id). */
function clientIdFromToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const id = Buffer.from(token.split('.')[0], 'base64').toString('utf8');
    return /^\d{15,25}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function invitePayload() {
  const clientId = botStatus.clientId ?? clientIdFromToken(getSetting('discord_token'));
  return {
    clientId,
    inviteUrl: clientId ? `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=${BOT_PERMISSIONS}` : null,
  };
}

app.get('/api/bot/status', admin, (_req, res) => {
  // a bot that stopped reporting is considered offline
  const stale = Date.now() - botStatus.updatedAt > 45_000;
  const base = stale ? { ...botStatus, state: 'error', error: 'Бот не отвечает (возможно, перезапускается). Если состояние не меняется больше минуты, на сервере выполните: sudo coregsm logs bot' } : botStatus;
  res.json({ ...base, ...invitePayload(), guildCount: botGuilds.length, channelCount: botGuilds.reduce((n, g) => n + g.channels.length, 0) });
});

// ---------- updates ----------
// The container never touches Docker or the host. "Update" drops a request file into UPDATE_DIR (a bind mount);
// a root systemd path unit on the host notices it and runs `coregsm-update`, which reports progress in status.json.
const UPDATE_DIR = process.env.UPDATE_DIR ?? '';
const APP_VERSION = process.env.APP_VERSION ?? '';
const UPDATE_BASE = process.env.UPDATE_BASE_URL ?? 'https://raw.githubusercontent.com/RJ-Bond/CoreGSM/refs/heads/main';

let remote: { build: string | null; error: string | null; at: number } = { build: null, error: null, at: 0 };

/** raw.githubusercontent.com is cached for minutes after a push; the GitHub API returns the file as it is now. */
function repoApiUrl(file: string): string | null {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?([^/]+)\/?$/.exec(UPDATE_BASE);
  return m ? `https://api.github.com/repos/${m[1]}/${m[2]}/contents/${file}?ref=${m[3]}` : null;
}

async function fetchRepoText(file: string): Promise<string> {
  const api = repoApiUrl(file);
  if (api) {
    try {
      const r = await fetch(api, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/vnd.github.raw+json', 'User-Agent': 'CoreGSM' } });
      if (r.ok) return await r.text();
    } catch {
      /* rate limit or no route: fall back to the plain file below */
    }
  }
  const res = await fetch(`${UPDATE_BASE}/${file}?t=${Date.now()}`, { signal: AbortSignal.timeout(8000), headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function checkRemote(force = false): Promise<void> {
  if (!force && Date.now() - remote.at < 5 * 60_000) return;
  try {
    const m = /^build=([a-f0-9]{6,64})$/m.exec(await fetchRepoText('version.txt'));
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
  admin,
  wrap(async (_req, res) => {
    await checkRemote();
    res.json(updatePayload());
  }),
);

app.post(
  '/api/update/check',
  admin,
  wrap(async (_req, res) => {
    await checkRemote(true);
    res.json(updatePayload());
  }),
);

app.post('/api/update/apply', admin, (_req, res) => {
  const state = updatePayload();
  if (!state.canApply) return res.status(503).json({ error: 'Обновление из панели не настроено на сервере. Выполните: sudo coregsm update' });
  if (state.job?.state === 'running') return res.status(409).json({ error: 'Обновление уже выполняется' });
  try {
    fs.writeFileSync(updateFile('request'), String(Date.now()));
  } catch {
    return res.status(500).json({ error: 'Не удалось создать запрос на обновление (нет прав на папку /app/update)' });
  }
  console.log('update requested from the panel');
  res.status(202).json(updatePayload());
});

// ---------- access: who may look at the panel, who may register ----------
// remember the public https address the panel is opened at: Discord needs it to load the embed thumbnail
function rememberPublicBase(req: Request) {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(':')[0];
  if (!host || host === 'localhost' || /^[\d.]+$/.test(host) || !host.includes('.')) return;
  const base = `https://${host}`;
  if (getSetting('public_base') !== base) setSetting('public_base', base);
}

const registrationMode = (): 'open' | 'approval' => (getSetting('registration_mode') === 'approval' ? 'approval' : 'open');
const rulesText = () => getSetting('rules_text') ?? '';
const discordLoginReady = () => !!getSetting('discord_client_secret') && !!(botStatus.clientId ?? clientIdFromToken(getSetting('discord_token')));
const accessPayload = () => ({
  publicPanel: publicPanel(),
  registration: registrationOpen(),
  registrationMode: registrationMode(),
  rules: rulesText(),
  discordLogin: discordLoginReady(),
  brand: brand(),
});

app.get('/api/access', (req, res) => {
  rememberPublicBase(req);
  res.json(accessPayload());
});
app.put('/api/access', admin, (req, res) => {
  const b = z
    .object({
      publicPanel: z.boolean().optional(),
      registration: z.boolean().optional(),
      registrationMode: z.enum(['open', 'approval']).optional(),
      rules: z.string().max(5000).optional(),
    })
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  if (b.data.publicPanel !== undefined) setSetting('public_panel', b.data.publicPanel ? '1' : '0');
  if (b.data.registration !== undefined) setSetting('registration_open', b.data.registration ? '1' : '0');
  if (b.data.registrationMode !== undefined) setSetting('registration_mode', b.data.registrationMode);
  if (b.data.rules !== undefined) setSetting('rules_text', b.data.rules.trim());
  res.json(accessPayload());
});

// ---------- branding: community name, accent colour and logo ----------
const LOGO_PATH = path.join(path.dirname(process.env.DB_PATH ?? './data/coregsm.db'), 'brand-logo');
const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const logoFile = () => Object.values(LOGO_TYPES).map((e) => `${LOGO_PATH}.${e}`).find((f) => fs.existsSync(f)) ?? null;
const brand = () => ({
  name: getSetting('brand_name') || 'CoreGSM',
  color: getSetting('brand_color') || '#4f46e5',
  hasLogo: !!logoFile(),
  logoV: logoFile() ? Math.floor(fs.statSync(logoFile()!).mtimeMs) : 0,
});

app.put('/api/branding', admin, (req, res) => {
  const b = z
    .object({ name: z.string().trim().min(1).max(32), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Название до 32 символов, цвет в виде #RRGGBB' });
  setSetting('brand_name', b.data.name);
  setSetting('brand_color', b.data.color.toLowerCase());
  res.json(brand());
});
app.put(
  '/api/branding/logo',
  admin,
  express.raw({ type: Object.keys(LOGO_TYPES), limit: '3mb' }),
  (req, res) => {
    const ext = LOGO_TYPES[String(req.headers['content-type'] ?? '').split(';')[0]];
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'Нужна картинка PNG, JPG или WebP до 3 МБ' });
    const old = logoFile();
    if (old) fs.rmSync(old, { force: true });
    fs.writeFileSync(`${LOGO_PATH}.${ext}`, req.body);
    res.json(brand());
  },
);
app.delete('/api/branding/logo', admin, (_req, res) => {
  const old = logoFile();
  if (old) fs.rmSync(old, { force: true });
  res.json(brand());
});
app.get('/api/branding/logo', (_req, res) => {
  const f = logoFile();
  if (!f) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=300').type(path.extname(f).slice(1)).send(fs.readFileSync(f));
});
// web app manifest (install the panel to the phone's home screen)
app.get('/api/manifest.json', (_req, res) => {
  const b = brand();
  const icon = b.hasLogo ? `/api/branding/logo?v=${b.logoV}` : '/logo-192.png';
  res.type('application/manifest+json').json({
    name: b.name,
    short_name: b.name.slice(0, 12),
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f5f7',
    theme_color: b.color,
    icons: [
      { src: icon, sizes: '192x192', purpose: 'any' },
      { src: icon, sizes: '512x512', purpose: 'any' },
    ],
  });
});


// ---------- registration of players ----------
const USERNAME_RE = /^(?=.{3,32}$)[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u;

app.get('/api/auth/check', (req, res) => {
  const name = String(req.query.username ?? '').trim();
  const valid = USERNAME_RE.test(name);
  const available = valid && !db.prepare('SELECT 1 FROM users WHERE ulower(username) = ?').get(name.toLowerCase());
  res.json({ valid, available });
});

app.post(
  '/api/auth/register',
  loginLimiter,
  wrap(async (req, res) => {
    if (needsSetup()) return res.status(409).json({ error: 'Панель ещё не настроена: сначала создайте администратора' });
    if (!registrationOpen()) return res.status(403).json({ error: 'Регистрация закрыта администратором' });
    const b = z
      .object({
        username: z.string().trim().regex(USERNAME_RE, 'Логин: 3-32 символа: буквы, цифры, пробел между словами, _ . -'),
        password: z.string().min(8, 'Пароль должен быть не короче 8 символов').max(256),
        acceptRules: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля формы' });
    if (rulesText() && !b.data.acceptRules) return res.status(400).json({ error: 'Нужно согласиться с правилами сообщества' });
    if (db.prepare('SELECT 1 FROM users WHERE ulower(username) = ?').get(b.data.username.toLowerCase())) {
      return res.status(409).json({ error: 'Этот логин уже занят' });
    }
    const hash = await bcrypt.hash(b.data.password, 12);
    const pending = registrationMode() === 'approval';
    try {
      const id = Number(
        db.prepare("INSERT INTO users (username, password_hash, role, created_at, status) VALUES (?, ?, 'player', ?, ?)").run(b.data.username, hash, Date.now(), pending ? 'pending' : 'active').lastInsertRowid,
      );
      if (pending) return res.status(202).json({ pending: true });
      res.status(201).json({ token: issueToken({ id, username: b.data.username }, req), username: b.data.username, role: 'player' });
    } catch {
      res.status(409).json({ error: 'Этот логин уже занят' });
    }
  }),
);

// ---------- user management (administrators) ----------
const adminCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get() as { n: number }).n;

app.get('/api/users', admin, (_req, res) => {
  const rows = db.prepare('SELECT id, username, role, created_at, status, discord_name FROM users ORDER BY (status = \'pending\') DESC, id').all() as {
    id: number;
    username: string;
    role: Role;
    created_at: number | null;
    status: string;
    discord_name: string | null;
  }[];
  res.json(rows.map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.created_at, status: u.status, discordName: u.discord_name })));
});

app.post('/api/users/:id/approve', admin, (req, res) => {
  const r = db.prepare("UPDATE users SET status = 'active' WHERE id = ? AND status = 'pending'").run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Заявка не найдена' });
  res.json({ ok: true });
});

app.put('/api/users/:id', admin, (req: AuthedRequest, res) => {
  const b = z.object({ role: z.enum(['admin', 'player']) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверная роль' });
  const id = Number(req.params.id);
  const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as { id: number; role: Role } | undefined;
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  if (u.role === 'admin' && b.data.role !== 'admin' && adminCount() <= 1) return res.status(409).json({ error: 'Нельзя снять права с последнего администратора' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.data.role, id);
  res.json({ ok: true });
});

app.put(
  '/api/users/:id/password',
  admin,
  wrap(async (req, res) => {
    const b = z.object({ password: z.string().min(8).max(256) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });
    const id = Number(req.params.id);
    const r = db.prepare('UPDATE users SET password_hash = ?, no_password = 0 WHERE id = ?').run(await bcrypt.hash(b.data.password, 12), id);
    if (!r.changes) return res.status(404).json({ error: 'Пользователь не найден' });
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    res.json({ ok: true });
  }),
);

app.delete('/api/users/:id', admin, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) return res.status(409).json({ error: 'Нельзя удалить собственную учётную запись' });
  const u = db.prepare('SELECT role, status FROM users WHERE id = ?').get(id) as { role: Role; status: string } | undefined;
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  if (u.role === 'admin' && u.status === 'active' && adminCount() <= 1) return res.status(409).json({ error: 'Нельзя удалить последнего администратора' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- favourites (any signed-in user) ----------
app.get('/api/favorites', auth, (req: AuthedRequest, res) => {
  const rows = db.prepare('SELECT server_id FROM favorites WHERE user_id = ?').all(req.user!.id) as { server_id: number }[];
  res.json(rows.map((r) => r.server_id));
});
app.put('/api/favorites/:id', auth, (req: AuthedRequest, res) => {
  const sid = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(sid)) return res.status(404).json({ error: 'Сервер не найден' });
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, server_id) VALUES (?, ?)').run(req.user!.id, sid);
  res.json({ ok: true });
});
app.delete('/api/favorites/:id', auth, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND server_id = ?').run(req.user!.id, Number(req.params.id));
  res.json({ ok: true });
});

// ---------- the signed-in user: profile, password, sessions, Discord account ----------
interface UserFull { id: number; username: string; role: Role; password_hash: string; no_password: number; discord_id: string | null; discord_name: string | null; discord_avatar: string | null }
const avatarUrl = (u: UserFull) => (u.discord_id && u.discord_avatar ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.discord_avatar}.png?size=64` : null);

app.get('/api/me', auth, (req: AuthedRequest, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserFull;
  res.json({ username: u.username, role: u.role, avatarUrl: avatarUrl(u), discordName: u.discord_name, hasPassword: !u.no_password });
});

app.post(
  '/api/auth/password',
  auth,
  wrap(async (req: AuthedRequest, res) => {
    const body = z.object({ current: z.string().optional(), next: z.string().min(8).max(256) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Новый пароль должен быть не короче 8 символов' });
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserFull;
    // an account created through Discord has no password yet: no current one to check
    if (!u.no_password && !(await bcrypt.compare(body.data.current ?? '', u.password_hash))) {
      return res.status(403).json({ error: 'Текущий пароль неверен' });
    }
    db.prepare('UPDATE users SET password_hash = ?, no_password = 0 WHERE id = ?').run(bcrypt.hashSync(body.data.next, 12), req.user!.id);
    // other devices have to sign in again with the new password
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user!.id, (req.user as { sid?: string }).sid ?? '');
    res.json({ ok: true });
  }),
);

app.get('/api/sessions', auth, (req: AuthedRequest, res) => {
  const cur = (req.user as { sid?: string }).sid;
  const rows = db.prepare('SELECT id, created_at, last_seen, ip, ua FROM sessions WHERE user_id = ? ORDER BY last_seen DESC').all(req.user!.id) as {
    id: string;
    created_at: number;
    last_seen: number;
    ip: string;
    ua: string;
  }[];
  res.json(rows.map((s) => ({ id: s.id, createdAt: s.created_at, lastSeen: s.last_seen, ip: s.ip, ua: s.ua, current: s.id === cur })));
});
app.post('/api/sessions/revoke-others', auth, (req: AuthedRequest, res) => {
  const r = db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user!.id, (req.user as { sid?: string }).sid ?? '');
  res.json({ ok: true, revoked: r.changes });
});
app.delete('/api/sessions/:id', auth, (req: AuthedRequest, res) => {
  const r = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(String(req.params.id), req.user!.id);
  if (!r.changes) return res.status(404).json({ error: 'Сеанс не найден' });
  res.json({ ok: true });
});

app.delete('/api/me/discord', auth, (req: AuthedRequest, res) => {
  const u = db.prepare('SELECT no_password FROM users WHERE id = ?').get(req.user!.id) as { no_password: number };
  if (u.no_password) return res.status(409).json({ error: 'Сначала задайте пароль в профиле: иначе войти будет нечем' });
  db.prepare('UPDATE users SET discord_id = NULL, discord_name = NULL, discord_avatar = NULL WHERE id = ?').run(req.user!.id);
  res.json({ ok: true });
});

// ---------- sign in with Discord (OAuth2, identify scope) ----------
const oauthStates = new Map<string, { mode: 'login' | 'link'; userId: number; exp: number }>();
const baseOf = (req: Request) => `${req.protocol}://${req.get('host')}`;
const redirectUri = (req: Request) => `${baseOf(req)}/api/auth/discord/callback`;
const toHash = (res: Response, hash: string) => res.redirect(302, `/#/${hash}`);
const failTo = (res: Response, msg: string) => toHash(res, `login/${encodeURIComponent(msg)}`);

app.get('/api/auth/discord/start', (req, res) => {
  const clientId = botStatus.clientId ?? clientIdFromToken(getSetting('discord_token'));
  if (!clientId || !getSetting('discord_client_secret')) return failTo(res, 'Вход через Discord не настроен администратором');
  const mode = req.query.mode === 'link' ? 'link' : 'login';
  let userId = 0;
  if (mode === 'link') {
    const u = userFromToken(String(req.query.t ?? ''));
    if (!u) return failTo(res, 'Сначала войдите в панель, затем привяжите Discord');
    userId = u.id;
  }
  for (const [k, v] of oauthStates) if (v.exp < Date.now()) oauthStates.delete(k);
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, { mode, userId, exp: Date.now() + 10 * 60_000 });
  const q = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: 'identify', redirect_uri: redirectUri(req), state, prompt: 'none' });
  res.redirect(302, `https://discord.com/oauth2/authorize?${q.toString()}`);
});

app.get(
  '/api/auth/discord/callback',
  wrap(async (req, res) => {
    const st = oauthStates.get(String(req.query.state ?? ''));
    oauthStates.delete(String(req.query.state ?? ''));
    if (!st || st.exp < Date.now()) return failTo(res, 'Сессия входа через Discord устарела, попробуйте ещё раз');
    if (req.query.error || !req.query.code) return failTo(res, 'Вход через Discord отменён');
    const clientId = botStatus.clientId ?? clientIdFromToken(getSetting('discord_token'));
    const secret = getSetting('discord_client_secret');
    if (!clientId || !secret) return failTo(res, 'Вход через Discord не настроен администратором');

    let me: { id: string; username: string; global_name?: string | null; avatar?: string | null };
    try {
      const tr = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: redirectUri(req) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!tr.ok) return failTo(res, 'Discord отклонил вход. Проверьте Client Secret и Redirect URI в настройках');
      const tok = (await tr.json()) as { access_token: string };
      const mr = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10_000) });
      if (!mr.ok) return failTo(res, 'Не удалось получить профиль из Discord');
      me = (await mr.json()) as typeof me;
    } catch {
      return failTo(res, 'Не удалось связаться с Discord');
    }
    const dname = me.global_name || me.username;
    const owner = db.prepare('SELECT id, username, status FROM users WHERE discord_id = ?').get(me.id) as { id: number; username: string; status: string } | undefined;

    if (st.mode === 'link') {
      if (owner && owner.id !== st.userId) return toHash(res, 'profile/' + encodeURIComponent('Этот Discord уже привязан к другому аккаунту'));
      db.prepare('UPDATE users SET discord_id = ?, discord_name = ?, discord_avatar = ? WHERE id = ?').run(me.id, dname, me.avatar ?? null, st.userId);
      return toHash(res, 'profile');
    }

    if (owner) {
      db.prepare('UPDATE users SET discord_name = ?, discord_avatar = ? WHERE id = ?').run(dname, me.avatar ?? null, owner.id);
      if (owner.status !== 'active') return failTo(res, 'Заявка на регистрацию ещё не одобрена администратором');
      return toHash(res, `auth/${issueToken(owner, req)}`);
    }

    // first sign-in with this Discord account: register it (when registration is open)
    if (!registrationOpen()) return failTo(res, 'Регистрация закрыта администратором');
    let base = dname.replace(/[^\p{L}\p{N}_.\- ]/gu, '').replace(/ +/g, ' ').trim().slice(0, 28);
    if (base.length < 3) base = `player${me.id.slice(-4)}`;
    let name = base;
    for (let i = 2; db.prepare('SELECT 1 FROM users WHERE ulower(username) = ?').get(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`.slice(0, 32);
    const pending = registrationMode() === 'approval';
    const id = Number(
      db
        .prepare("INSERT INTO users (username, password_hash, role, created_at, status, discord_id, discord_name, discord_avatar, no_password) VALUES (?, ?, 'player', ?, ?, ?, ?, ?, 1)")
        .run(name, bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 4), Date.now(), pending ? 'pending' : 'active', me.id, dname, me.avatar ?? null).lastInsertRowid,
    );
    if (pending) return failTo(res, 'Заявка отправлена. Дождитесь одобрения администратора');
    toHash(res, `auth/${issueToken({ id, username: name }, req)}`);
  }),
);

// ---------- servers ----------
const serverSchema = z.object({
  // optional: when empty the title is taken from the game server's own reply
  name: z.string().trim().max(64).optional(),
  game: z.string().trim().min(1).max(32).regex(/^[a-z0-9_]+$/i),
  host: z.string().trim().min(1).max(255).regex(/^[a-z0-9.\-:]+$/i),
  port: z.number().int().min(1).max(65535),
  queryPort: z.number().int().min(1).max(65535).nullable().optional(),
  // what people see instead of host:port, e.g. a public IP or domain (the panel still queries `host`)
  displayAddress: z
    .string()
    .trim()
    .max(100)
    .regex(/^[^\s<>"']*$/, 'Адрес для отображения не должен содержать пробелов и кавычек')
    .optional(),
  // two-letter country code shown in the Discord message; empty = detect from the address
  country: z.string().trim().regex(/^([A-Za-z]{2})?$/, 'Страна: двухбуквенный код').optional(),
});

/** What a non-admin may see: the display address, never the internal host/port used for querying. */
function publicServer<T extends { host: string; port: number; queryPort: number | null; customName: string }>(s: T): T {
  return { ...s, host: '', port: 0, queryPort: null, customName: '' };
}

type ServerJoin = ServerRow & Partial<Omit<StatusRow, 'server_id' | 'name'>> & { has_status: number | null; query_name: string | null };

function serialize(r: ServerJoin) {
  return {
    id: r.id,
    // shown title: custom name > name reported by the server > host:port
    name: r.name || r.query_name || r.display_address || `${r.host}:${r.port}`,
    customName: r.name,
    nameAuto: !r.name,
    game: r.game,
    host: r.host,
    port: r.port,
    queryPort: r.query_port,
    displayAddress: r.display_address,
    country: r.country ?? '',
    // the address shown in the panel and on cards
    address: r.display_address || `${r.host}:${r.port}`,
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
       st.updated_at, st.server_id AS has_status, st.name AS query_name
FROM servers s LEFT JOIN status st ON st.server_id = s.id`;

function getServer(id: number) {
  const row = db.prepare(`${SELECT_SERVERS} WHERE s.id = ?`).get(id) as ServerJoin | undefined;
  return row ? serialize(row) : null;
}

app.get('/api/servers', viewer, (req, res) => {
  const rows = db.prepare(`${SELECT_SERVERS} ORDER BY s.id`).all() as ServerJoin[];
  const list = rows.map(serialize);
  res.json(isAdmin(req) ? list : list.map(publicServer));
});

app.post(
  '/api/servers',
  admin,
  wrap(async (req, res) => {
    const b = serverSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля формы' });
    const info = db
      .prepare('INSERT INTO servers (name, game, host, port, query_port, display_address, country, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(b.data.name ?? '', b.data.game, b.data.host, b.data.port, b.data.queryPort ?? null, b.data.displayAddress ?? '', (b.data.country ?? '').toUpperCase(), Date.now());
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(info.lastInsertRowid) as ServerRow;
    await refreshServer(row);
    res.status(201).json(getServer(row.id));
  }),
);

app.put(
  '/api/servers/:id',
  admin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const b = serverSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля формы' });
    const r = db
      .prepare('UPDATE servers SET name=?, game=?, host=?, port=?, query_port=?, display_address=?, country=? WHERE id=?')
      .run(b.data.name ?? '', b.data.game, b.data.host, b.data.port, b.data.queryPort ?? null, b.data.displayAddress ?? '', (b.data.country ?? '').toUpperCase(), id);
    if (!r.changes) return res.status(404).json({ error: 'Сервер не найден' });
    await refreshServer(db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as ServerRow);
    res.json(getServer(id));
  }),
);

app.delete('/api/servers/:id', admin, (req, res) => {
  const r = db.prepare('DELETE FROM servers WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Сервер не найден' });
  res.json({ ok: true });
});

// try a server without saving it: used by the "Проверить" button in the add/edit form
app.post(
  '/api/servers/test',
  admin,
  wrap(async (req, res) => {
    const b = serverSchema.pick({ game: true, host: true, port: true, queryPort: true }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Укажите игру, адрес и порт' });
    const r = await queryServer({
      id: 0,
      name: '',
      display_address: '',
      country: '',
      game: b.data.game,
      host: b.data.host,
      port: b.data.port,
      query_port: b.data.queryPort ?? null,
      created_at: 0,
    });
    res.json(r);
  }),
);

// everything the server page needs: chart points, uptime, peak, outage log
app.get('/api/servers/:id/details', viewer, (req, res) => {
  const id = Number(req.params.id);
  const server = getServer(id);
  if (!server) return res.status(404).json({ error: 'Сервер не найден' });
  const hours = Math.min(168, Math.max(1, Number(req.query.hours ?? 24)));
  const since = Date.now() - hours * 3600 * 1000;
  const bucketMs = Math.max(30_000, Math.ceil((hours * 3600 * 1000) / 180));

  const points = db
    .prepare(
      `SELECT MIN(ts) AS ts, MAX(players) AS players, MIN(online) AS online
       FROM history WHERE server_id = ? AND ts > ?
       GROUP BY ts / CAST(? AS INTEGER) ORDER BY ts`,
    )
    .all(id, since, bucketMs);
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS samples, AVG(online) * 100 AS uptime,
              AVG(CASE WHEN online = 1 THEN players END) AS avg_players
       FROM history WHERE server_id = ? AND ts > ?`,
    )
    .get(id, since) as { samples: number; uptime: number | null; avg_players: number | null };
  const peak = db
    .prepare('SELECT players, ts FROM history WHERE server_id = ? AND ts > ? ORDER BY players DESC, ts DESC LIMIT 1')
    .get(id, since) as { players: number; ts: number } | undefined;
  const events = (
    db
      .prepare(
        `SELECT ts, online FROM (
           SELECT ts, online, LAG(online) OVER (ORDER BY ts) AS prev FROM history WHERE server_id = ? AND ts > ?
         ) WHERE prev IS NOT NULL AND prev <> online ORDER BY ts DESC LIMIT 30`,
      )
      .all(id, since) as { ts: number; online: number }[]
  ).map((e) => ({ ts: e.ts, type: e.online ? 'up' : 'down' }));

  res.json({
    server: isAdmin(req) ? server : publicServer(server),
    hours,
    points,
    stats: {
      samples: agg.samples,
      uptimePct: agg.uptime == null ? null : Math.round(agg.uptime * 10) / 10,
      avgPlayers: agg.avg_players == null ? null : Math.round(agg.avg_players * 10) / 10,
      peakPlayers: peak?.players ?? null,
      peakAt: peak?.ts ?? null,
    },
    events,
  });
});

app.post(
  '/api/servers/:id/refresh',
  admin,
  wrap(async (req, res) => {
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(Number(req.params.id)) as ServerRow | undefined;
    if (!row) return res.status(404).json({ error: 'Сервер не найден' });
    await refreshServer(row);
    res.json(getServer(row.id));
  }),
);

app.get('/api/servers/:id/history', viewer, (req, res) => {
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

// game pictogram for embeds (public: Discord fetches it)
app.get(
  '/api/game-icon/:game.png',
  wrap(async (req, res) => {
    const game = String(req.params.game).replace(/[^a-z0-9_]/gi, '');
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }).send(await renderGameIcon(game));
  }),
);

// ---------- discord bindings ----------
const bindingSchema = z.object({
  serverId: z.number().int(),
  channelId: z.string().regex(/^\d{15,25}$/, 'ID канала — число из 15–25 цифр'),
  intervalSec: z.number().int().min(30).max(3600).default(60),
  enabled: z.boolean().default(true),
  // omitted on update = keep the current style
  style: z.enum(['embed', 'card', 'both']).optional(),
});

// guilds and text channels the bot can post in (reported by the bot, used for the channel picker)
interface BotGuild {
  id: string;
  name: string;
  /** text channels the bot can see but not write to */
  hidden?: number;
  channels: { id: string; name: string; missing?: string[] }[];
}
// persisted, so a backend restart does not leave the channel picker empty until the bot reports again
function loadGuilds(): BotGuild[] {
  try {
    const v = JSON.parse(getSetting('bot_guilds') ?? '[]');
    return Array.isArray(v) ? (v as BotGuild[]) : [];
  } catch {
    return [];
  }
}
let botGuilds: BotGuild[] = loadGuilds();

function channelInfo(channelId: string): { channelName: string | null; guildName: string | null; guildId: string | null } {
  for (const g of botGuilds) {
    const c = g.channels.find((x) => x.id === channelId);
    if (c) return { channelName: c.name, guildName: g.name, guildId: g.id };
  }
  return { channelName: null, guildName: null, guildId: null };
}

app.get('/api/discord/channels', admin, (_req, res) => {
  res.json(botGuilds);
});

const serializeBinding = (b: BindingRow) => ({
  channelName: channelInfo(b.channel_id).channelName,
  guildName: channelInfo(b.channel_id).guildName,
  id: b.id,
  serverId: b.server_id,
  channelId: b.channel_id,
  messageId: b.message_id,
  intervalSec: b.interval_sec,
  enabled: !!b.enabled,
  lastUpdate: b.last_update,
  lastError: b.last_error,
  style: b.style,
});

// The Discord embed for a server. One builder serves the bot (what is posted) and the panel (the preview).
function embedFor(serverId: number, intervalSec: number) {
  const server = getServer(serverId);
  if (!server) return null;
  const up = db
    .prepare('SELECT AVG(online) * 100 AS u FROM history WHERE server_id = ? AND ts > ?')
    .get(serverId, Date.now() - 24 * 3600 * 1000) as { u: number | null };
  const last = db.prepare('SELECT MAX(ts) AS t FROM history WHERE server_id = ? AND online = 1').get(serverId) as { t: number | null };
  const base = getSetting('public_base');
  return buildEmbed(server, up.u, intervalSec, { lastOnlineAt: last.t, thumbUrl: base ? `${base}/api/game-icon/${server.game}.png` : null, baseUrl: base, version: APP_VERSION || null, brandName: brand().name, country: (() => { const c = server.country || countryOf(serverId, server.host); return c ? countryLabel(c) : null; })(), timeZone: getSetting('timezone') || process.env.TZ || 'Europe/Moscow', logoUrl: base && logoFile() ? `${base}/api/branding/logo?v=${brand().logoV}` : null });
}

const intervalParam = (v: unknown) => Math.min(3600, Math.max(30, Number(v) || 60));

app.get('/api/servers/:id/embed', admin, (req, res) => {
  const e = embedFor(Number(req.params.id), intervalParam(req.query.interval));
  if (!e) return res.status(404).json({ error: 'Сервер не найден' });
  res.json(e);
});

app.get('/api/bindings', admin, (_req, res) => {
  res.json((db.prepare('SELECT * FROM bindings ORDER BY id').all() as BindingRow[]).map(serializeBinding));
});

app.post('/api/bindings', admin, (req, res) => {
  const b = bindingSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Неверные данные' });
  if (!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(b.data.serverId)) {
    return res.status(400).json({ error: 'Сервер не найден' });
  }
  const info = db
    .prepare('INSERT INTO bindings (server_id, channel_id, interval_sec, enabled, style) VALUES (?, ?, ?, ?, ?)')
    .run(b.data.serverId, b.data.channelId, b.data.intervalSec, b.data.enabled ? 1 : 0, b.data.style ?? 'embed');
  res.status(201).json(serializeBinding(db.prepare('SELECT * FROM bindings WHERE id = ?').get(info.lastInsertRowid) as BindingRow));
});

app.put('/api/bindings/:id', admin, (req, res) => {
  const b = bindingSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Неверные данные' });
  const id = Number(req.params.id);
  const old = db.prepare('SELECT * FROM bindings WHERE id = ?').get(id) as BindingRow | undefined;
  if (!old) return res.status(404).json({ error: 'Не найдено' });
  // moving to another channel/server means a new message must be posted
  const resetMsg = old.channel_id !== b.data.channelId || old.server_id !== b.data.serverId;
  db.prepare(
    'UPDATE bindings SET server_id=?, channel_id=?, interval_sec=?, enabled=?, style=?, message_id=CASE WHEN ? THEN NULL ELSE message_id END WHERE id=?',
  ).run(b.data.serverId, b.data.channelId, b.data.intervalSec, b.data.enabled ? 1 : 0, b.data.style ?? old.style, resetMsg ? 1 : 0, id);
  res.json(serializeBinding(db.prepare('SELECT * FROM bindings WHERE id = ?').get(id) as BindingRow));
});

app.delete('/api/bindings/:id', admin, (req, res) => {
  const r = db.prepare('DELETE FROM bindings WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ---------- internal (bot only, not exposed by nginx) ----------
function internal(req: Request, res: Response, next: NextFunction) {
  if (safeEqual(String(req.headers['x-internal-token'] ?? ''), INTERNAL_TOKEN)) return next();
  res.status(403).json({ error: 'forbidden' });
}

app.get('/internal/servers/:id/embed', internal, (req, res) => {
  const e = embedFor(Number(req.params.id), intervalParam(req.query.interval));
  if (!e) return res.status(404).json({ error: 'not found' });
  res.json(e);
});

app.get('/internal/config', internal, (_req, res) => {
  res.json({ discordToken: getSetting('discord_token') ?? '', proxyUrl: getSetting('proxy_url') ?? '' });
});

app.post('/internal/bot-guilds', internal, (req, res) => {
  const b = z
    .array(
      z.object({
        id: z.string().max(30),
        name: z.string().max(120),
        hidden: z.number().int().min(0).optional(),
        channels: z.array(z.object({ id: z.string().max(30), name: z.string().max(120), missing: z.array(z.string().max(40)).max(4).optional() })).max(300),
      }),
    )
    .max(60)
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'bad body' });
  botGuilds = b.data;
  setSetting('bot_guilds', JSON.stringify(b.data));
  res.json({ ok: true });
});

app.post('/internal/bot-status', internal, (req, res) => {
  const b = z
    .object({
      state: z.enum(['idle', 'connecting', 'online', 'error']),
      tag: z.string().max(100).nullable().optional(),
      clientId: z.string().regex(/^\d{15,25}$/).nullable().optional(),
      error: z.string().max(300).nullable().optional(),
    })
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'bad body' });
  botStatus = { state: b.data.state, tag: b.data.tag ?? null, clientId: b.data.clientId ?? null, error: b.data.error ?? null, updatedAt: Date.now() };
  res.json({ ok: true });
});

app.get('/internal/bindings', internal, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT b.*, ${EFFECTIVE_NAME} AS server_name FROM bindings b JOIN servers s ON s.id = b.server_id LEFT JOIN status st ON st.server_id = s.id WHERE b.enabled = 1`,
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

registerNews({ app, admin, viewer, internal, channelInfo, isAdmin });
registerAlerts({ app, admin, internal, channelInfo });
registerOps({ app, admin, getBot: () => botStatus, guildCount: () => botGuilds.length, version: APP_VERSION, pollMs: POLL_MS });

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

