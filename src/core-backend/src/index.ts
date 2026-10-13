import express, { type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db, EFFECTIVE_NAME, getSetting, setSetting, type BindingRow, type ServerRow, type StatusRow } from './db.js';
import { queryServer, refreshServer, startPoller } from './gsm.js';
import { isKnownGame, renderCard, renderGameIcon } from './card.js';
import { registerBackups, startBackupTimer } from './backup.js';
import { gameLabel } from './games.js';
import { buildEmbed } from './embed.js';
import { registerNews } from './news.js';
import { installAudit, registerOps } from './ops.js';
import { registerAlerts } from './alerts.js';
import { customAvatarUrl, registerAvatars, removeAvatar } from './avatars.js';
import { bannerPresetOf, bannerUrlOf, logAccount, prefsOf, registerProfile, removeBanner, uaLabel } from './profile.js';
import { coverUrl, registerCovers, removeCover } from './covers.js';
import { discordFetch } from './proxyFetch.js';
import { countryLabel, countryOf } from './geo.js';

const PORT = Number(process.env.PORT ?? 3000);
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? '';
const POLL_MS = Number(process.env.POLL_INTERVAL_SEC ?? 30) * 1000;
// one-time code that protects the first-run setup wizard from strangers who find the panel first
const SETUP_TOKEN = process.env.SETUP_TOKEN || crypto.randomBytes(8).toString('hex');

if (JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set and at least 32 characters long (generate one with: openssl rand -hex 32)');
  process.exit(1);
}
if (INTERNAL_TOKEN.length < 16) {
  console.error('INTERNAL_TOKEN must be set (min 16 chars)');
  process.exit(1);
}
// a real bcrypt hash (cost 12) to compare against when the login does not exist: the response time stays the same
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 12);

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
type Role = 'admin' | 'moderator' | 'player';
interface AuthedRequest extends Request {
  user?: { id: number; username: string; role: Role; sid?: string };
}

/** The signed-in user (checked against the database, so a deleted or demoted account loses access at once). */
function userFromToken(token: string): { id: number; username: string; role: Role; sid: string } | null {
  if (!token) return null;
  try {
    const p = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { sub: string; sid?: string };
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

/** Starts a session and returns the signed token for it. */
function issueToken(u: { id: number; username: string }, req: Request): string {
  const sid = crypto.randomBytes(12).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen, ip, ua) VALUES (?, ?, ?, ?, ?, ?)').run(sid, u.id, now, now, (req.ip ?? '').slice(0, 64), uaLabel(req.headers['user-agent']));
  return jwt.sign({ username: u.username, sid }, JWT_SECRET, { subject: String(u.id), expiresIn: '7d', algorithm: 'HS256' });
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - 8 * 24 * 3600 * 1000), 3600_000).unref();

const isAdmin = (req: Request) => (req as AuthedRequest).user?.role === 'admin';
const isStaff = (req: Request) => {
  const r = (req as AuthedRequest).user?.role;
  return r === 'admin' || r === 'moderator';
};
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
/** administrators and moderators (news and the Discord channel list) */
function staff(req: AuthedRequest, res: Response, next: NextFunction) {
  const u = loadUser(req);
  if (!u) return void res.status(401).json({ error: 'Требуется вход' });
  if (u.role !== 'admin' && u.role !== 'moderator') return void res.status(403).json({ error: 'Это действие доступно администратору и модератору' });
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

/** a lighter per-address limit for public lookups: `max` requests per minute */
function rateLimit(max: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  setInterval(() => { for (const [k, v] of hits) if (v.reset < Date.now()) hits.delete(k); }, 60_000).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'x';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset <= now) hits.set(key, { n: 1, reset: now + 60_000 });
    else if (++h.n > max) return void res.status(429).json({ error: 'Слишком много запросов. Подождите минуту.' });
    next();
  };
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
    const ok = await bcrypt.compare(body.data.password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok) {
      const f = fails.get(key) ?? { n: 0, until: 0 };
      f.n++;
      if (f.n >= LOCK_AFTER) f.until = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (f.n - LOCK_AFTER));
      fails.set(key, f);
      if (u) logAccount(req, u.id, 'login_failed');
      const attemptsLeft = Math.max(0, LOCK_AFTER - f.n);
      return res.status(401).json({ error: 'Неверный логин или пароль', attemptsLeft: f.n >= LOCK_AFTER ? 0 : attemptsLeft });
    }
    fails.delete(key);
    if (u.status !== 'active') return res.status(403).json({ error: 'Заявка на регистрацию ещё не одобрена администратором', pending: true });
    attempts.delete(req.ip ?? 'x');
    logAccount(req, u.id, 'login');
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
    discordRedirect: req ? `${publicBase() ?? baseOf(req)}/api/auth/discord/callback` : '',
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
  // progress: 0..100 written by the manager/installer while an update runs (absent in older managers)
  let job: { state: string; message: string; time: number; rollback_available?: boolean; progress?: number } | null = null;
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
    // the host manager keeps the previous version and says so in status.json
    canRollback: dirOk && job?.rollback_available === true,
    job,
  };
}

// ---- changelog: the last commits of the repository the panel updates from
const GITHUB_API = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '');
interface ChangelogItem { sha: string; title: string; date: number | null; url: string }
let changelog: { at: number; items: ChangelogItem[]; error: string | null } | null = null;

function commitsUrl(): string | null {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?([^/]+)\/?$/.exec(UPDATE_BASE);
  return m ? `${GITHUB_API}/repos/${m[1]}/${m[2]}/commits?per_page=15&sha=${encodeURIComponent(m[3])}` : null;
}

/** first line of the message without "Co-Authored-By" trailers */
const commitTitle = (msg: string): string =>
  msg
    .split(/\r?\n/)
    .filter((l) => !/^co-authored-by:/i.test(l.trim()))[0]
    ?.trim()
    .slice(0, 200) ?? '';

async function loadChangelog(): Promise<{ items: ChangelogItem[]; error?: string }> {
  if (changelog && Date.now() - changelog.at < (changelog.error ? 60_000 : 10 * 60_000)) {
    return changelog.error ? { items: changelog.items, error: changelog.error } : { items: changelog.items };
  }
  const url = commitsUrl();
  try {
    if (!url) throw new Error('адрес репозитория обновлений не распознан');
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CoreGSM' } });
    if (!r.ok) throw new Error(`GitHub ответил HTTP ${r.status}`);
    const list = (await r.json()) as { sha?: string; html_url?: string; commit?: { message?: string; committer?: { date?: string }; author?: { date?: string } } }[];
    if (!Array.isArray(list)) throw new Error('неожиданный ответ GitHub');
    const items = list.slice(0, 15).map((c) => {
      const d = Date.parse(c.commit?.committer?.date ?? c.commit?.author?.date ?? '');
      return { sha: String(c.sha ?? ''), title: commitTitle(String(c.commit?.message ?? '')), date: Number.isNaN(d) ? null : d, url: String(c.html_url ?? '') };
    });
    changelog = { at: Date.now(), items, error: null };
    return { items };
  } catch (e) {
    const error = `Не удалось получить список изменений: ${(e as Error).message}`;
    changelog = { at: Date.now(), items: changelog?.items ?? [], error };
    return { items: changelog.items, error };
  }
}

app.get(
  '/api/update/changelog',
  admin,
  wrap(async (_req, res) => {
    res.json(await loadChangelog());
  }),
);

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

// same request file, different word: the host manager reads it and restores the previous version
app.post('/api/update/rollback', admin, (_req, res) => {
  const state = updatePayload();
  if (!state.canApply) return res.status(503).json({ error: 'Откат из панели не настроен на сервере. Выполните: sudo coregsm rollback' });
  if (state.job?.state === 'running') return res.status(409).json({ error: 'Сейчас выполняется обновление или откат' });
  if (!state.canRollback) return res.status(409).json({ error: 'Откат недоступен: предыдущая версия не сохранена' });
  if (state.pending) return res.status(409).json({ error: 'Запрос уже ожидает выполнения' });
  try {
    fs.writeFileSync(updateFile('request'), 'rollback');
  } catch {
    return res.status(500).json({ error: 'Не удалось создать запрос на откат (нет прав на папку /app/update)' });
  }
  console.log('rollback requested from the panel');
  res.status(202).json(updatePayload());
});

// ---------- access: who may look at the panel, who may register ----------
// The public https address of the panel (Discord needs it to load embed images). Trusted sources only, in this order:
// PUBLIC_URL, https://DOMAIN, and the address an administrator opened the panel at (saved from an authenticated request).
// A guest's Host header is never stored: it would let anyone point the embeds at their own server.
const isRealDomain = (d: string) => /^[a-z0-9.-]+$/i.test(d) && d.includes('.') && !/^[\d.]+$/.test(d) && d.toLowerCase() !== 'localhost';
function publicBase(): string | null {
  const env = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^\s/]+$/i.test(env)) return env;
  const d = (process.env.DOMAIN ?? '').trim();
  if (isRealDomain(d)) return `https://${d}`;
  return getSetting('public_base') || null;
}
/** called only for requests that carry a valid administrator token */
function rememberAdminBase(req: Request) {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim().split(':')[0];
  if (!isRealDomain(host)) return;
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

app.get('/api/access', (_req, res) => {
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
  color2: getSetting('brand_color2') || '',
  preset: getSetting('brand_preset') || '',
  hasLogo: !!logoFile(),
  logoV: logoFile() ? Math.floor(fs.statSync(logoFile()!).mtimeMs) : 0,
});

app.put('/api/branding', admin, (req, res) => {
  const b = z
    .object({
      name: z.string().trim().min(1).max(32),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      color2: z.string().regex(/^(#[0-9a-fA-F]{6})?$/).optional(),
      preset: z.string().trim().max(24).optional(),
    })
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Название до 32 символов, цвет в виде #RRGGBB' });
  setSetting('brand_name', b.data.name);
  setSetting('brand_color', b.data.color.toLowerCase());
  setSetting('brand_color2', (b.data.color2 ?? '').toLowerCase());
  setSetting('brand_preset', b.data.preset ?? '');
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
      { src: icon, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: b.hasLogo ? icon : '/logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // the maskable icon has a full-bleed background and a safe zone (Android adaptive icons)
      { src: '/logo-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});


// ---------- registration of players ----------
const USERNAME_RE = /^(?=.{3,32}$)[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u;

app.get('/api/auth/check', rateLimit(30), (req, res) => {
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
  const b = z.object({ role: z.enum(['admin', 'moderator', 'player']) }).safeParse(req.body);
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
    logAccount(req, id, 'password_changed', 'сброшен администратором');
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
  removeAvatar(id);
  removeBanner(id);
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
interface UserFull { id: number; username: string; role: Role; password_hash: string; no_password: number; discord_id: string | null; discord_name: string | null; discord_avatar: string | null; email?: string | null }
const avatarUrl = (u: UserFull) => (u.discord_id && u.discord_avatar ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.discord_avatar}.png?size=64` : null);

app.get('/api/me', auth, (req: AuthedRequest, res) => {
  if (req.user!.role === 'admin') rememberAdminBase(req);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserFull;
  // an uploaded picture wins over the Discord avatar
  const custom = customAvatarUrl(u.id);
  res.json({
    username: u.username,
    role: u.role,
    avatarUrl: custom ?? avatarUrl(u),
    avatarSource: custom ? 'custom' : avatarUrl(u) ? 'discord' : null,
    discordName: u.discord_name,
    hasPassword: !u.no_password,
    email: u.email ?? null,
    prefs: prefsOf(u.id),
    bannerUrl: bannerUrlOf(u.id),
    bannerPreset: bannerPresetOf(u.id),
  });
});

// e-mail of the account (a recovery and notification address); changing it asks for the current password
app.put(
  '/api/me/email',
  auth,
  wrap(async (req: AuthedRequest, res) => {
    const body = z.object({ email: z.string().trim().max(254), current: z.string().optional() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Проверьте адрес' });
    const email = body.data.email.toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Некорректный адрес электронной почты' });
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserFull;
    if (!u.no_password && !(await bcrypt.compare(body.data.current ?? '', u.password_hash))) {
      return res.status(403).json({ error: 'Введите текущий пароль, чтобы изменить почту' });
    }
    if (email) {
      const taken = db.prepare('SELECT id FROM users WHERE lower(email) = ? AND id != ?').get(email, req.user!.id);
      if (taken) return res.status(409).json({ error: 'Этот адрес уже привязан к другому аккаунту' });
    }
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email || null, req.user!.id);
    if ((u.email ?? '') !== email) logAccount(req, u.id, 'email_changed');
    res.json({ ok: true, email: email || null });
  }),
);

app.post(
  '/api/auth/password',
  auth,
  wrap(async (req: AuthedRequest, res) => {
    const body = z.object({ current: z.string().optional(), next: z.string().min(8).max(256), confirm: z.string().optional() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Новый пароль должен быть не короче 8 символов' });
    if (body.data.confirm !== undefined && body.data.confirm !== body.data.next) return res.status(400).json({ error: 'Пароли не совпадают' });
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserFull;
    // an account created through Discord has no password yet: no current one to check
    if (!u.no_password && !(await bcrypt.compare(body.data.current ?? '', u.password_hash))) {
      return res.status(403).json({ error: 'Текущий пароль неверен' });
    }
    db.prepare('UPDATE users SET password_hash = ?, no_password = 0 WHERE id = ?').run(bcrypt.hashSync(body.data.next, 12), req.user!.id);
    // other devices have to sign in again with the new password
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user!.id, (req.user as { sid?: string }).sid ?? '');
    logAccount(req, req.user!.id, 'password_changed');
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
  if (r.changes) logAccount(req, req.user!.id, 'sessions_revoked', `завершено: ${r.changes}`);
  res.json({ ok: true, revoked: r.changes });
});
// logout: ends the session this very token belongs to
app.delete('/api/sessions/current', auth, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(req.user!.sid ?? '', req.user!.id);
  res.json({ ok: true });
});
app.delete('/api/sessions/:id', auth, (req: AuthedRequest, res) => {
  const r = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(String(req.params.id), req.user!.id);
  if (!r.changes) return res.status(404).json({ error: 'Сеанс не найден' });
  logAccount(req, req.user!.id, 'sessions_revoked', 'завершён один сеанс');
  res.json({ ok: true });
});

app.delete('/api/me/discord', auth, (req: AuthedRequest, res) => {
  const u = db.prepare('SELECT no_password FROM users WHERE id = ?').get(req.user!.id) as { no_password: number };
  if (u.no_password) return res.status(409).json({ error: 'Сначала задайте пароль в профиле: иначе войти будет нечем' });
  db.prepare('UPDATE users SET discord_id = NULL, discord_name = NULL, discord_avatar = NULL WHERE id = ?').run(req.user!.id);
  logAccount(req, req.user!.id, 'discord_unlinked');
  res.json({ ok: true });
});

// ---------- sign in with Discord (OAuth2, identify scope) ----------
const oauthStates = new Map<string, { mode: 'login' | 'link'; userId: number; exp: number }>();
const baseOf = (req: Request) => `${req.protocol}://${req.get('host')}`;
const redirectUri = (req: Request) => `${publicBase() ?? baseOf(req)}/api/auth/discord/callback`;
const toHash = (res: Response, hash: string) => res.redirect(302, `/#/${hash}`);
const failTo = (res: Response, msg: string) => toHash(res, `login/${encodeURIComponent(msg)}`);

app.get('/api/auth/discord/start', rateLimit(30), (req, res) => {
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
  // bounded memory: the oldest pending sign-ins are dropped first
  while (oauthStates.size >= 1000) oauthStates.delete(oauthStates.keys().next().value as string);
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
      const tr = await discordFetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: redirectUri(req) }),
      });
      if (!tr.ok) return failTo(res, 'Discord отклонил вход. Проверьте Client Secret и Redirect URI в настройках');
      const tok = (await tr.json()) as { access_token: string };
      const mr = await discordFetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${tok.access_token}` } });
      if (!mr.ok) return failTo(res, 'Не удалось получить профиль из Discord');
      me = (await mr.json()) as typeof me;
    } catch (e) {
      console.error('discord oauth request failed:', (e as Error).message);
      return failTo(res, getSetting('proxy_url') ? 'Не удалось связаться с Discord через прокси. Проверьте прокси в настройках бота' : 'Не удалось связаться с Discord. Если он недоступен напрямую, задайте прокси в настройках бота');
    }
    const dname = me.global_name || me.username;
    const owner = db.prepare('SELECT id, username, status FROM users WHERE discord_id = ?').get(me.id) as { id: number; username: string; status: string } | undefined;

    if (st.mode === 'link') {
      if (owner && owner.id !== st.userId) return toHash(res, 'profile/' + encodeURIComponent('Этот Discord уже привязан к другому аккаунту'));
      db.prepare('UPDATE users SET discord_id = ?, discord_name = ?, discord_avatar = ? WHERE id = ?').run(me.id, dname, me.avatar ?? null, st.userId);
      logAccount(req, st.userId, 'discord_linked', dname);
      return toHash(res, 'profile');
    }

    if (owner) {
      db.prepare('UPDATE users SET discord_name = ?, discord_avatar = ? WHERE id = ?').run(dname, me.avatar ?? null, owner.id);
      if (owner.status !== 'active') return failTo(res, 'Заявка на регистрацию ещё не одобрена администратором');
      logAccount(req, owner.id, 'login', 'Discord');
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
    coverUrl: coverUrl(r.id),
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
  removeCover(Number(req.params.id));
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
  // up to 30 days may be asked for; samples are kept for 7 days, so the chart simply shows what exists
  const hours = Math.min(720, Math.max(1, Number(req.query.hours ?? 24)));
  const since = Date.now() - hours * 3600 * 1000;
  const bucketMs = Math.max(30_000, Math.ceil((hours * 3600 * 1000) / 180));

  const points = db
    .prepare(
      `SELECT MIN(ts) AS ts, MAX(players) AS players, MIN(online) AS online,
              CAST(ROUND(AVG(CASE WHEN online = 1 THEN ping END)) AS INTEGER) AS ping
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
  ).map((e) => ({ ts: e.ts, type: (e.online ? 'up' : 'down') as 'up' | 'down' | 'peak', players: null as number | null }));
  // the busiest moment of the period is shown in the event feed as well
  if (peak && peak.players > 0) events.push({ ts: peak.ts, type: 'peak', players: peak.players });
  events.sort((a, b) => b.ts - a.ts);

  const playersNow = (db.prepare('SELECT name, since FROM player_now WHERE server_id = ? ORDER BY since, name LIMIT 200').all(id) as { name: string; since: number }[]).map((p) => ({ name: p.name, since: p.since }));

  // additive: when the server was added and (admins only) where its Discord message lives
  const createdAt = (db.prepare('SELECT created_at FROM servers WHERE id = ?').get(id) as { created_at: number } | undefined)?.created_at || null;
  const discord = isAdmin(req)
    ? (db.prepare('SELECT * FROM bindings WHERE server_id = ? ORDER BY id').all(id) as BindingRow[]).map((b) => {
        const c = channelInfo(b.channel_id);
        return { channelId: b.channel_id, channelName: c.channelName, guildName: c.guildName, guildId: c.guildId, messageId: b.message_id, enabled: !!b.enabled };
      })
    : [];

  res.json({
    server: { ...(isAdmin(req) ? server : publicServer(server)), countryCode: server.country || countryOf(id, server.host) || '' },
    hours,
    createdAt,
    discord,
    playersNow,
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

// public PNG card (shared links, link previews). A private panel hides it unless the request carries a session token (?t=).
app.get(
  '/api/card/:id(\\d+).png',
  wrap(async (req, res) => {
    if (!publicPanel() && !userFromToken(String(req.query.t ?? ''))) return res.status(404).json({ error: 'Сервер не найден' });
    const buf = await renderCard(Number(req.params.id));
    if (!buf) return res.status(404).json({ error: 'Сервер не найден' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }).send(buf);
  }),
);

/** bump when the game icon artwork changes: Discord caches embed images by URL */
const GAME_ICON_VERSION = 3;

// game pictogram for embeds (public: Discord fetches it); unknown ids get the generic icon
app.get(
  '/api/game-icon/:game.png',
  wrap(async (req, res) => {
    const game = String(req.params.game).replace(/[^a-z0-9_]/gi, '');
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }).send(await renderGameIcon(isKnownGame(game) ? game : ''));
  }),
);

// ---------- public server page: a link that looks good when pasted into Discord/Telegram ----------
const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

app.get('/s/:id(\\d+)', (req, res) => {
  res.set({ 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' });
  const gone = () =>
    void res
      .status(404)
      .type('html')
      .send('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Не найдено</title></head><body style="font-family:sans-serif;padding:2rem"><h1>Страница недоступна</h1><p><a href="/">На главную</a></p></body></html>');
  if (!publicPanel()) return gone();
  const id = Number(req.params.id);
  const sv = getServer(id);
  if (!sv) return gone();
  const base = publicBase() ?? baseOf(req);
  const b = brand();
  // never the internal host:port; when the server has no title the game name stands in
  const title = sv.name === `${sv.host}:${sv.port}` ? gameLabel(sv.game) : sv.name;
  const parts: string[] = [];
  if (!sv.hasStatus) parts.push('Состояние неизвестно');
  else if (!sv.online) parts.push('Сервер недоступен');
  else {
    parts.push(`Онлайн: ${sv.players}${sv.maxPlayers ? `/${sv.maxPlayers}` : ''}`);
    if (sv.map) parts.push(`Карта: ${sv.map}`);
  }
  parts.push(`Игра: ${gameLabel(sv.game)}`);
  const desc = parts.join(' · ');
  const target = `/#/servers/${id}`;
  const url = `${base}/s/${id}`;
  const image = `${base}/api/card/${id}.png`;
  res.type('html').send(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(b.name)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="${esc(b.color)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(b.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="480">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="ru_RU">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<script>location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')});</script>
</head>
<body>
<p><a href="${esc(target)}">${esc(title)}</a></p>
</body>
</html>`);
});

// ---------- status page data ----------
app.get('/api/status', viewer, (req, res) => {
  const rows = db.prepare(`${SELECT_SERVERS} ORDER BY s.id`).all() as ServerJoin[];
  const list = rows.map(serialize);
  const servers = isAdmin(req) ? list : list.map(publicServer);
  const now = Date.now();
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) days.push(new Date(now - i * 86400_000).toISOString().slice(0, 10));
  const daily = new Map<string, { up: number; total: number }>();
  for (const r of db.prepare('SELECT server_id, day, up, total FROM uptime_daily WHERE day >= ?').all(days[0]) as { server_id: number; day: string; up: number; total: number }[]) {
    daily.set(`${r.server_id}|${r.day}`, r);
  }
  const pings = new Map<number, number>();
  for (const r of db.prepare('SELECT server_id, AVG(ping) AS a FROM history WHERE ts > ? AND online = 1 AND ping IS NOT NULL GROUP BY server_id').all(now - 24 * 3600_000) as { server_id: number; a: number }[]) {
    pings.set(r.server_id, Math.round(r.a));
  }
  const pct = (up: number, total: number) => (total > 0 ? Math.round((up / total) * 1000) / 10 : null);
  const last = (db.prepare('SELECT MAX(updated_at) AS t FROM status').get() as { t: number | null }).t;
  res.json({
    updatedAt: last ?? now,
    servers: servers.map((sv) => {
      let up = 0;
      let total = 0;
      const dd = days.map((day) => {
        const r = daily.get(`${sv.id}|${day}`);
        if (r) {
          up += r.up;
          total += r.total;
        }
        return { day, pct: r ? pct(r.up, r.total) : null };
      });
      return {
        id: sv.id,
        name: sv.name,
        game: sv.game,
        address: sv.address,
        coverUrl: sv.coverUrl,
        online: sv.online,
        players: sv.players,
        maxPlayers: sv.maxPlayers,
        uptime30: pct(up, total),
        days: dd,
        avgPing: pings.get(sv.id) ?? null,
      };
    }),
  });
});

// ---------- discord bindings ----------
const bindingSchema = z.object({
  serverId: z.number().int(),
  // more servers in the same message (Discord allows up to 10 embeds in one message)
  extraServerIds: z.array(z.number().int()).max(9).optional(),
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

app.get('/api/discord/channels', staff, (_req, res) => {
  res.json(botGuilds);
});

/** the extra servers of a binding (ids that still exist, without the main one and without duplicates) */
function extraIds(b: BindingRow): number[] {
  try {
    const raw = JSON.parse(b.extra_ids || '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<number>([b.server_id]);
    const out: number[] = [];
    for (const v of raw) {
      const n = Number(v);
      if (!Number.isInteger(n) || seen.has(n)) continue;
      if (!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  } catch {
    return [];
  }
}

const cleanExtra = (main: number, ids: number[] | undefined): number[] =>
  [...new Set(ids ?? [])].filter((n) => n !== main && !!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(n)).slice(0, 9);

const serializeBinding = (b: BindingRow) => ({
  channelName: channelInfo(b.channel_id).channelName,
  guildName: channelInfo(b.channel_id).guildName,
  id: b.id,
  serverId: b.server_id,
  // every server shown in the message: the main one first
  serverIds: [b.server_id, ...extraIds(b)],
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
  const base = publicBase();
  return buildEmbed(server, up.u, intervalSec, { serverId, lastOnlineAt: last.t, thumbUrl: base ? `${base}/api/game-icon/${server.game}.png?v=${GAME_ICON_VERSION}` : null, baseUrl: base, version: APP_VERSION || null, brandName: brand().name, country: (() => { const c = server.country || countryOf(serverId, server.host); return c ? countryLabel(c) : null; })(), timeZone: getSetting('timezone') || process.env.TZ || 'Europe/Moscow', logoUrl: base && logoFile() ? `${base}/api/branding/logo?v=${brand().logoV}` : null });
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
    .prepare('INSERT INTO bindings (server_id, channel_id, interval_sec, enabled, style, extra_ids) VALUES (?, ?, ?, ?, ?, ?)')
    .run(b.data.serverId, b.data.channelId, b.data.intervalSec, b.data.enabled ? 1 : 0, b.data.style ?? 'embed', JSON.stringify(cleanExtra(b.data.serverId, b.data.extraServerIds)));
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
  // omitted = keep the current extra servers (a pause/resume from the list does not send them)
  const extra = b.data.extraServerIds === undefined ? extraIds(old) : cleanExtra(b.data.serverId, b.data.extraServerIds);
  db.prepare(
    'UPDATE bindings SET server_id=?, channel_id=?, interval_sec=?, enabled=?, style=?, extra_ids=?, message_id=CASE WHEN ? THEN NULL ELSE message_id END WHERE id=?',
  ).run(b.data.serverId, b.data.channelId, b.data.intervalSec, b.data.enabled ? 1 : 0, b.data.style ?? old.style, JSON.stringify(extra), resetMsg ? 1 : 0, id);
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

// the same PNG card, for the bot (works while the panel is private)
app.get(
  '/internal/card/:id(\\d+).png',
  internal,
  wrap(async (req, res) => {
    const buf = await renderCard(Number(req.params.id));
    if (!buf) return res.status(404).json({ error: 'not found' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }).send(buf);
  }),
);

// "Refresh" button on the Discord message: query the game server right now
app.post(
  '/internal/servers/:id/refresh',
  internal,
  wrap(async (req, res) => {
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(Number(req.params.id)) as ServerRow | undefined;
    if (!row) return res.status(404).json({ error: 'not found' });
    await refreshServer(row);
    res.json({ ok: true });
  }),
);

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

const bindingForBot = (id: number) => {
  const r = db
    .prepare(`SELECT b.*, ${EFFECTIVE_NAME} AS server_name FROM bindings b JOIN servers s ON s.id = b.server_id LEFT JOIN status st ON st.server_id = s.id WHERE b.id = ?`)
    .get(id) as (BindingRow & { server_name: string }) | undefined;
  return r ? { ...serializeBinding(r), serverName: r.server_name } : null;
};

// one binding, enabled or not (the buttons on the Discord message work for paused ones too)
app.get('/internal/bindings/:id', internal, (req, res) => {
  const b = bindingForBot(Number(req.params.id));
  if (!b) return res.status(404).json({ error: 'not found' });
  res.json(b);
});
for (const [action, enabled] of [['pause', 0], ['resume', 1]] as const) {
  app.post(`/internal/bindings/:id/${action}`, internal, (req, res) => {
    const id = Number(req.params.id);
    const r = db.prepare('UPDATE bindings SET enabled = ? WHERE id = ?').run(enabled, id);
    if (!r.changes) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, binding: bindingForBot(id) });
  });
}

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

registerNews({
  app,
  staff,
  viewer,
  internal,
  channelInfo,
  isStaff,
  servers: () =>
    (db.prepare(`${SELECT_SERVERS} ORDER BY s.id`).all() as ServerJoin[]).map(serialize).map((s) => ({
      id: s.id,
      name: s.name,
      players: s.players,
      maxPlayers: s.maxPlayers,
      online: s.online,
      address: s.address,
      map: s.map,
      ping: s.ping,
    })),
  statusEmbed: (id) => embedFor(id, 60),
});
registerAlerts({ app, admin, internal, channelInfo });
registerAvatars({ app, auth, userId: (req) => (req as AuthedRequest).user!.id, onChange: (req, id, what) => logAccount(req, id, 'avatar_changed', what) });
registerProfile({
  app,
  auth,
  rateLimit,
  userId: (req) => (req as AuthedRequest).user!.id,
  avatarOf: (id) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserFull | undefined;
    return customAvatarUrl(id) ?? (u ? avatarUrl(u) : null);
  },
});
registerCovers({ app, admin });
registerOps({ app, admin, getBot: () => botStatus, guildCount: () => botGuilds.length, version: APP_VERSION, pollMs: POLL_MS, publicBase });
registerBackups({ app, admin });

// ---------- errors ----------
app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  // body-parser: broken JSON / too large body are the client's mistake, not a server error
  if (err.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Некорректный JSON в запросе' });
  if (err.type === 'entity.too.large') return void res.status(413).json({ error: 'Слишком большой запрос' });
  if (err.type === 'request.aborted' || err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') return void res.status(400).json({ error: 'Некорректный запрос' });
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
  startBackupTimer();
});

