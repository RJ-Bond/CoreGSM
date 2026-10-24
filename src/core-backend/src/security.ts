/**
 * Security: session cookie + CSRF guard, response headers, per-IP limiters and login lockout, e-mail (SMTP settings,
 * address verification, password reset) and the new-device notice.
 *
 * Trust proxy: index.ts sets `trust proxy` to 1 hop (the nginx container in front of the backend). req.ip and req.secure
 * therefore come from the last X-Forwarded-For / X-Forwarded-Proto value written by that nginx. The backend port is
 * not published by docker-compose; if it ever is, a client could spoof its address, so keep it internal.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { Express, Request, RequestHandler, Response } from 'express';
import { db, setSetting } from './db.js';
import { guardGet, guardSet } from './loginGuard.js';
import { addColumn } from './schema.js';
import { wrap } from './http.js';
import { enqueueDelivery } from './deliveries.js';
import { layout, mailReady, sendMail, smtpConfig } from './mail.js';
import { logAccount, prefsOf, uaLabel } from './profile.js';
import { log } from './logger.js';

// ---------- schema ----------
addColumn(db, 'users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);
CREATE TABLE IF NOT EXISTS login_fingerprints (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fp TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (user_id, fp)
);
`);
setInterval(() => {
  const now = Date.now();
  db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(now - 24 * 3600_000);
  db.prepare('DELETE FROM email_verifications WHERE expires_at < ?').run(now - 24 * 3600_000);
}, 3600_000).unref();

// ---------- session cookie and CSRF ----------
export const SESSION_COOKIE = 'coregsm_session';
/** lifetime of a session token (issueToken signs it for the same period) */
export const SESSION_TTL_MS = 7 * 24 * 3600_000;

export function readCookie(req: Request, name: string): string {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

export function setSessionCookie(req: Request, res: Response, token: string, maxAgeMs = SESSION_TTL_MS): void {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', secure: req.secure, maxAge: maxAgeMs });
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/', secure: req.secure });
}

/**
 * A state-changing request that carries the session cookie but no Authorization header must prove it comes from our
 * own page: a cross-site form or fetch cannot add the custom X-CoreGSM header (it would need a CORS preflight).
 */
export const csrfGuard: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!req.headers.cookie || !readCookie(req, SESSION_COOKIE)) return next();
  if (req.headers.authorization || req.headers['x-coregsm']) return next();
  res.status(403).json({ error: 'Запрос отклонён: не хватает заголовка X-CoreGSM' });
};

/** helmet-like headers for everything the backend answers; HSTS only over https */
export const securityHeaders: RequestHandler = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  // API answers are data (JSON, images): nothing may run or load from them
  if (req.path.startsWith('/api/')) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  next();
};

// ---------- limiters ----------
/** `max` requests per `windowMs` for one address; answers 429 with Retry-After */
export function windowLimiter(max: number, windowMs: number, message = 'Слишком много запросов. Попробуйте позже.'): RequestHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  setInterval(() => {
    for (const [k, v] of hits) if (v.reset < Date.now()) hits.delete(k);
  }, 60_000).unref();
  return (req, res, next) => {
    const key = req.ip ?? 'x';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset <= now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) {
      const retryAfter = Math.max(1, Math.ceil((h.reset - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return void res.status(429).json({ error: message, retryAfter });
    }
    next();
  };
}

// per-address lockout after repeated failed logins across different usernames (the per-account lockout is in auth.ts)
const IP_LOCK_AFTER = 6;
const IP_LOCK_MIN_NAMES = 3;
// kept in SQLite (loginGuard.ts): a restart does not lift a lockout
interface IpFails { n: number; names: string[]; until: number; last: number; level: number }

/** seconds until this address may try again (0 = not locked) */
export function ipLockRemaining(ip: string | undefined): number {
  const f = guardGet<IpFails>('ip', ip ?? 'x');
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}

export function ipLoginFailed(ip: string | undefined, username: string): void {
  const key = ip ?? 'x';
  const now = Date.now();
  let f = guardGet<IpFails>('ip', key);
  if (!f || f.last < now - 30 * 60_000) f = { n: 0, names: [], until: 0, last: now, level: f?.level ?? 0 };
  f.n++;
  f.last = now;
  const name = username.toLowerCase();
  if (f.names.length < 50 && !f.names.includes(name)) f.names.push(name);
  if (f.n >= IP_LOCK_AFTER && f.names.length >= IP_LOCK_MIN_NAMES) {
    // 1, 2, 4 ... up to 30 minutes
    f.until = now + Math.min(30 * 60_000, 60_000 * 2 ** f.level);
    f.level++;
    f.n = 0;
    f.names = [];
  }
  // forgotten an hour after the last failure (and never while locked)
  guardSet('ip', key, f, Math.max(f.until, f.last + 3600_000));
}

// ---------- tokens ----------
const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------- new-device notice ----------
/** "203.0.113" for IPv4 (the /24 network), the first 64 bits for IPv6 */
function ipPrefix(ip: string): string {
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}`;
  return ip.split(':').filter(Boolean).slice(0, 4).join(':');
}

const emailOf = (userId: number) =>
  db.prepare('SELECT username, email, email_verified FROM users WHERE id = ?').get(userId) as { username: string; email: string | null; email_verified: number } | undefined;

/**
 * Called after a successful sign-in. The first sign-in of an account only records the fingerprint (hash of browser/OS
 * family and the /24 network); a later one from an unseen fingerprint writes a 'login_new_device' journal entry and,
 * when the address is verified and SMTP works, sends a letter.
 */
export function noteLogin(req: Request, userId: number, brandName: string): void {
  try {
    const label = uaLabel(req.headers['user-agent']);
    const ip = String(req.ip ?? '');
    const fp = crypto.createHash('sha256').update(`${label}|${ipPrefix(ip)}`).digest('hex').slice(0, 32);
    const now = Date.now();
    const known = db.prepare('SELECT 1 FROM login_fingerprints WHERE user_id = ? AND fp = ?').get(userId, fp);
    if (known) {
      db.prepare('UPDATE login_fingerprints SET last_seen = ? WHERE user_id = ? AND fp = ?').run(now, userId, fp);
      return;
    }
    const first = !db.prepare('SELECT 1 FROM login_fingerprints WHERE user_id = ? LIMIT 1').get(userId);
    db.prepare('INSERT OR IGNORE INTO login_fingerprints (user_id, fp, first_seen, last_seen) VALUES (?, ?, ?, ?)').run(userId, fp, now, now);
    if (first) return;
    const detail = `${label} · ${ip}`.slice(0, 200);
    db.prepare('INSERT INTO account_events (user_id, ts, kind, ip, ua, detail) VALUES (?, ?, ?, ?, ?, ?)').run(userId, now, 'login_new_device', ip.slice(0, 64), label, detail);
    const u = emailOf(userId);
    if (u?.email && u.email_verified && mailReady()) {
      const en = prefsOf(userId).lang === 'en';
      const body = layout(
        brandName,
        en
          ? [`A new sign-in to your account "${u.username}" from a device we have not seen before.`, `Device: ${label}`, `Address: ${ip}`, 'If this was not you, change your password and end other sessions in the profile.']
          : [`Новый вход в аккаунт «${u.username}» с устройства, которого мы раньше не видели.`, `Устройство: ${label}`, `Адрес: ${ip}`, 'Если это были не вы, смените пароль и завершите чужие сеансы в профиле.'],
      );
      void sendMail({ to: u.email, subject: en ? 'New sign-in to your account' : 'Новый вход в аккаунт', ...body }).catch((e) => log.error('new-device mail failed:', (e as Error).message));
    }
  } catch (e) {
    log.error('noteLogin failed', (e as Error).message);
  }
}

/** the newest new-device event of the last 24 h (for /api/me) */
export function recentNewDevice(userId: number): { ts: number; label: string } | null {
  const r = db
    .prepare("SELECT ts, detail FROM account_events WHERE user_id = ? AND kind = 'login_new_device' AND ts > ? ORDER BY ts DESC LIMIT 1")
    .get(userId, Date.now() - 24 * 3600_000) as { ts: number; detail: string } | undefined;
  return r ? { ts: r.ts, label: r.detail } : null;
}

/** a changed address is not verified any more; letters for the old one stop working */
export function emailChanged(userId: number): void {
  db.prepare('UPDATE users SET email_verified = 0 WHERE id = ?').run(userId);
  db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(userId);
}

// ---------- routes ----------
export interface SecurityDeps {
  app: Express;
  admin: RequestHandler;
  auth: RequestHandler;
  userId: (req: Request) => number;
  userFromToken: (token: string) => { id: number } | null;
  /** trusted public address of the panel (never taken from a guest's Host header) */
  publicBase: () => string | null;
  /** address of the current request (used for letters to the signed-in user only) */
  baseOf: (req: Request) => string;
  brandName: () => string;
}

const FORGOT_TEXT = 'Если у аккаунта есть подтверждённая почта или привязанный Discord, мы отправили ссылку для сброса пароля: письмом на почту и личным сообщением от бота в Discord.';

export function registerSecurity(d: SecurityDeps): void {
  const { app } = d;
  const smtpLimiter = windowLimiter(10, 10 * 60_000);
  const forgotLimiter = windowLimiter(5, 15 * 60_000, 'Слишком много запросов на сброс пароля. Попробуйте позже.');
  const resetLimiter = windowLimiter(10, 15 * 60_000);
  const verifyLimiter = windowLimiter(20, 15 * 60_000);
  const sessionLimiter = windowLimiter(30, 60_000);

  // ----- SMTP settings (administrator) -----
  const smtpPayload = () => {
    const c = smtpConfig();
    return { host: c.host, port: c.port, secure: c.secure, user: c.user, from: c.from, passwordSet: !!c.password, ready: mailReady(), publicBase: d.publicBase() };
  };
  app.get('/api/settings/smtp', d.admin, (_req, res) => {
    res.json(smtpPayload());
  });
  const smtpSchema = z.object({
    host: z.string().trim().max(255).regex(/^[a-z0-9.:-]*$/i, 'Адрес сервера: только имя хоста или IP').optional(),
    port: z.number().int().min(1).max(65535).optional(),
    secure: z.boolean().optional(),
    user: z.string().trim().max(200).regex(/^[^\r\n]*$/).optional(),
    // undefined = keep, '' = clear
    password: z.string().max(300).regex(/^[^\r\n]*$/).optional(),
    from: z
      .string()
      .trim()
      .max(200)
      .regex(/^[^\r\n<>]*(<[^\s@<>]+@[^\s@<>]+>)?$/, 'Отправитель: адрес или «Имя <адрес>»')
      .optional(),
  });
  app.put('/api/settings/smtp', d.admin, (req, res) => {
    const b = smtpSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля формы' });
    const v = b.data;
    if (v.host !== undefined) setSetting('smtp_host', v.host);
    if (v.port !== undefined) setSetting('smtp_port', String(v.port));
    if (v.secure !== undefined) setSetting('smtp_secure', v.secure ? '1' : '0');
    if (v.user !== undefined) setSetting('smtp_user', v.user);
    if (v.password !== undefined) setSetting('smtp_password', v.password);
    if (v.from !== undefined) setSetting('smtp_from', v.from);
    try {
      db.prepare('INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)').run(Date.now(), (req as Request & { user?: { username: string } }).user?.username ?? '—', 'Изменены настройки почты (SMTP)', '');
    } catch {
      /* the journal is best effort */
    }
    res.json(smtpPayload());
  });
  app.post('/api/settings/smtp/test', d.admin, smtpLimiter, async (req, res) => {
    const b = z.object({ to: z.string().trim().max(254) }).safeParse(req.body);
    if (!b.success || !EMAIL_RE.test(b.data.to)) return res.status(400).json({ error: 'Укажите адрес, на который отправить пробное письмо' });
    if (!mailReady()) return res.status(400).json({ error: 'Сначала укажите SMTP-сервер и сохраните настройки' });
    const body = layout(d.brandName(), ['Это пробное письмо: почта панели настроена правильно.']);
    try {
      await sendMail({ to: b.data.to, subject: `${d.brandName()}: пробное письмо`, ...body });
      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  // ----- e-mail verification -----
  const lastVerifyRequest = new Map<number, number>();
  app.post('/api/me/email/verify-request', d.auth, wrap(async (req, res) => {
    const id = d.userId(req);
    const u = emailOf(id);
    if (!u?.email) return res.status(400).json({ error: 'Сначала укажите адрес электронной почты' });
    if (u.email_verified) return res.json({ ok: true, alreadyVerified: true });
    if (!mailReady()) return res.status(503).json({ error: 'Отправка почты не настроена администратором' });
    const wait = 60_000 - (Date.now() - (lastVerifyRequest.get(id) ?? 0));
    if (wait > 0) {
      res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
      return res.status(429).json({ error: 'Письмо уже отправлено. Подождите минуту перед повторной отправкой.', retryAfter: Math.ceil(wait / 1000) });
    }
    lastVerifyRequest.set(id, Date.now());
    const token = newToken();
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(id);
    db.prepare('INSERT INTO email_verifications (token_hash, user_id, email, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), id, u.email.toLowerCase(), Date.now() + 24 * 3600_000);
    const en = prefsOf(id).lang === 'en';
    // links with a token use the #/ form: a fragment never reaches the server, so the token stays out of access logs
    const url = `${d.publicBase() ?? d.baseOf(req)}/#/verify/${token}`;
    const body = layout(
      d.brandName(),
      en ? [`Confirm the e-mail address of your account "${u.username}".`, 'The link works for 24 hours.'] : [`Подтвердите адрес электронной почты аккаунта «${u.username}».`, 'Ссылка действует 24 часа.'],
      { label: en ? 'Confirm address' : 'Подтвердить адрес', url },
    );
    try {
      await sendMail({ to: u.email, subject: en ? 'Confirm your e-mail' : 'Подтверждение почты', ...body });
      res.json({ ok: true });
    } catch (e) {
      lastVerifyRequest.delete(id);
      res.status(502).json({ error: (e as Error).message });
    }
  }));

  app.post('/api/auth/verify-email', verifyLimiter, (req, res) => {
    const bad = () => res.status(400).json({ error: 'Ссылка недействительна или устарела' });
    const b = z.object({ token: z.string().min(10).max(200) }).safeParse(req.body);
    if (!b.success) return bad();
    const row = db.prepare('SELECT * FROM email_verifications WHERE token_hash = ?').get(hashToken(b.data.token)) as
      | { token_hash: string; user_id: number; email: string; expires_at: number; used_at: number | null }
      | undefined;
    if (!row || row.used_at || row.expires_at < Date.now()) return bad();
    const u = emailOf(row.user_id);
    // the address was changed after the letter was sent
    if (!u?.email || u.email.toLowerCase() !== row.email) return bad();
    db.transaction(() => {
      db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id);
      db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(row.user_id);
    })();
    logAccount(req, row.user_id, 'email_changed', 'адрес подтверждён');
    res.json({ ok: true, email: u.email });
  });

  // ----- password reset -----
  const perAccount = new Map<number, number[]>();
  app.post('/api/auth/forgot', forgotLimiter, (req, res) => {
    const b = z.object({ login: z.string().trim().min(1).max(254) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Введите логин или адрес почты' });
    // the answer is the same whatever happens below: no account enumeration
    res.json({ ok: true, message: FORGOT_TEXT });
    const login = b.data.login.toLowerCase();
    setImmediate(() => {
      void (async () => {
        try {
          const u = db
            .prepare("SELECT id, username, email, email_verified, discord_id FROM users WHERE status = 'active' AND (ulower(username) = ? OR (email IS NOT NULL AND lower(email) = ?))")
            .get(login, login) as { id: number; username: string; email: string | null; email_verified: number; discord_id: string | null } | undefined;
          if (!u) return;
          // the link goes to every channel the account has: a verified e-mail and/or the linked Discord (a private message from the bot)
          const viaMail = !!u.email && !!u.email_verified && mailReady();
          const viaDiscord = !!u.discord_id;
          if (!viaMail && !viaDiscord) return;
          const base = d.publicBase();
          if (!base) {
            log.error('password reset letter not sent: the public address of the panel is unknown (set PUBLIC_URL or DOMAIN)');
            return;
          }
          // at most 3 letters per account per hour
          const now = Date.now();
          const recent = (perAccount.get(u.id) ?? []).filter((t) => t > now - 3600_000);
          if (recent.length >= 3) return;
          perAccount.set(u.id, [...recent, now]);
          const token = newToken();
          db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(now, u.id);
          db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), u.id, now + 30 * 60_000);
          const en = prefsOf(u.id).lang === 'en';
          const resetUrl = `${base}/#/reset/${token}`;
          if (viaDiscord) {
            const text = en
              ? `🔐 A password reset was requested for the account "${u.username}".\nSet a new password (the link works for 30 minutes and only once):\n${resetUrl}\n\nIf this was not you, ignore this message: the password stays as it is.`
              : `🔐 Запрошен сброс пароля для аккаунта «${u.username}».\nЗадайте новый пароль (ссылка действует 30 минут и только один раз):\n${resetUrl}\n\nЕсли это были не вы, просто проигнорируйте сообщение: пароль останется прежним.`;
            enqueueDelivery({ kind: 'dm', refId: null, target: u.discord_id!, payload: { content: text, summary: en ? 'Password reset' : 'Сброс пароля' } });
          }
          if (viaMail) {
            const body = layout(
              d.brandName(),
              en
                ? [`A password reset was requested for the account "${u.username}".`, 'The link works for 30 minutes and only once. If this was not you, just ignore this letter.']
                : [`Запрошен сброс пароля для аккаунта «${u.username}».`, 'Ссылка действует 30 минут и только один раз. Если это были не вы, просто проигнорируйте письмо.'],
              { label: en ? 'Set a new password' : 'Задать новый пароль', url: resetUrl },
            );
            await sendMail({ to: u.email!, subject: en ? 'Password reset' : 'Сброс пароля', ...body });
          }
        } catch (e) {
          log.error('password reset letter failed:', (e as Error).message);
        }
      })();
    });
  });

  app.post('/api/auth/reset', resetLimiter, wrap(async (req, res) => {
    const bad = () => res.status(400).json({ error: 'Ссылка недействительна или устарела. Запросите сброс ещё раз.' });
    const b = z.object({ token: z.string().min(10).max(200), password: z.string().min(8, 'Пароль должен быть не короче 8 символов').max(256) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля формы' });
    const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(hashToken(b.data.token)) as
      | { token_hash: string; user_id: number; expires_at: number; used_at: number | null }
      | undefined;
    if (!row || row.used_at || row.expires_at < Date.now()) return bad();
    const hash = await bcrypt.hash(b.data.password, 12);
    // claim the token first: two parallel requests cannot both use it
    const claim = db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ?').run(Date.now(), row.token_hash, Date.now());
    if (!claim.changes) return bad();
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, no_password = 0 WHERE id = ?').run(hash, row.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(Date.now(), row.user_id);
    })();
    logAccount(req, row.user_id, 'password_changed', 'сброс по ссылке из письма');
    // a confirmation in Discord too: if it was not the owner, they see it at once
    const dm = db.prepare('SELECT username, discord_id FROM users WHERE id = ?').get(row.user_id) as { username: string; discord_id: string | null } | undefined;
    if (dm?.discord_id) {
      const enDm = prefsOf(row.user_id).lang === 'en';
      const text = enDm
        ? `✅ The password of the account "${dm.username}" was changed. All sessions were ended. If this was not you, contact an administrator.`
        : `✅ Пароль аккаунта «${dm.username}» изменён, все сеансы завершены. Если это были не вы, срочно сообщите администратору.`;
      enqueueDelivery({ kind: 'dm', refId: null, target: dm.discord_id, payload: { content: text, summary: enDm ? 'Password changed' : 'Пароль изменён' } });
    }
    const u = emailOf(row.user_id);
    if (u?.email && u.email_verified && mailReady()) {
      const en = prefsOf(row.user_id).lang === 'en';
      const body = layout(d.brandName(), en ? [`The password of the account "${u.username}" was changed. All sessions were ended.`] : [`Пароль аккаунта «${u.username}» изменён. Все сеансы завершены.`]);
      void sendMail({ to: u.email, subject: en ? 'Password changed' : 'Пароль изменён', ...body }).catch(() => undefined);
    }
    res.json({ ok: true });
  }));

  // ----- cookie for a client that signed in the old way (Bearer token only) -----
  app.post('/api/auth/session', sessionLimiter, (req, res) => {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    const u = token ? d.userFromToken(token) : null;
    if (!u) return res.status(401).json({ error: 'Требуется вход' });
    const exp = (jwt.decode(token) as { exp?: number } | null)?.exp;
    const left = exp ? exp * 1000 - Date.now() : SESSION_TTL_MS;
    setSessionCookie(req, res, token, Math.max(60_000, Math.min(SESSION_TTL_MS, left)));
    res.json({ ok: true });
  });
}
