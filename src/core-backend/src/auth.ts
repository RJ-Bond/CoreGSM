/** Sessions, roles and the access middleware; login rate limits and lockout. */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { INTERNAL_TOKEN, JWT_SECRET } from './config.js';
import { type BanRow, activeBan } from './banLogic.js';
import { db, getSetting } from './db.js';
import { safeEqual } from './http.js';
import { guardDelete, guardGet, guardSet } from './loginGuard.js';
import { uaLabel } from './profile.js';
import { readCookie, SESSION_COOKIE } from './security.js';

// a real bcrypt hash (cost 12) to compare against when the login does not exist: the response time stays the same
export const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 12);

// ---------- auth ----------
export type Role = 'admin' | 'moderator' | 'player';
export interface AuthedRequest extends Request {
  user?: { id: number; username: string; role: Role; sid?: string };
}

/** The signed-in user (checked against the database, so a deleted or demoted account loses access at once). */
export function userFromToken(token: string): { id: number; username: string; role: Role; sid: string } | null {
  if (!token) return null;
  try {
    const p = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { sub: string; sid?: string };
    // a token without a session id predates sessions: sign in again
    if (!p.sid) return null;
    const u = db.prepare("SELECT id, username, role, banned_at, banned_until, ban_reason FROM users WHERE id = ? AND status = 'active'").get(Number(p.sub)) as ({ id: number; username: string; role: Role } & BanRow) | undefined;
    if (!u) return null;
    if (activeBan(u, Date.now())) return null;
    // an ended session (revoked from the profile) stops working at once
    if (!db.prepare('SELECT 1 FROM sessions WHERE id = ? AND user_id = ?').get(p.sid, u.id)) return null;
    const now = Date.now();
    if (now - (lastSeen.get(p.sid) ?? 0) > 60_000) {
      lastSeen.set(p.sid, now);
      db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now, p.sid);
    }
    return { id: u.id, username: u.username, role: u.role, sid: p.sid };
  } catch {
    return null;
  }
}
export const lastSeen = new Map<string, number>();

/** Bearer header first (API clients, the bot), then the HttpOnly session cookie of the web panel. */
export function loadUser(req: Request) {
  const h = req.headers.authorization ?? '';
  return userFromToken(h.startsWith('Bearer ') ? h.slice(7) : '') ?? userFromToken(readCookie(req, SESSION_COOKIE));
}

/** Starts a session and returns the signed token for it. */
export function issueToken(u: { id: number; username: string }, req: Request): string {
  const sid = crypto.randomBytes(12).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen, ip, ua) VALUES (?, ?, ?, ?, ?, ?)').run(sid, u.id, now, now, (req.ip ?? '').slice(0, 64), uaLabel(req.headers['user-agent']));
  return jwt.sign({ username: u.username, sid }, JWT_SECRET, { subject: String(u.id), expiresIn: '7d', algorithm: 'HS256' });
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - 8 * 24 * 3600 * 1000), 3600_000).unref();

export const isAdmin = (req: Request) => (req as AuthedRequest).user?.role === 'admin';
export const isStaff = (req: Request) => {
  const r = (req as AuthedRequest).user?.role;
  return r === 'admin' || r === 'moderator';
};
export const flag = (key: string, fallback: boolean) => {
  const v = getSetting(key);
  return v === null ? fallback : v === '1';
};
export const publicPanel = () => flag('public_panel', true);
export const registrationOpen = () => flag('registration_open', true);

/** any signed-in user */
export function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const u = loadUser(req);
  if (!u) return void res.status(401).json({ error: 'Требуется вход' });
  req.user = u;
  next();
}
/** administrators only */
export function admin(req: AuthedRequest, res: Response, next: NextFunction) {
  const u = loadUser(req);
  if (!u) return void res.status(401).json({ error: 'Требуется вход' });
  if (u.role !== 'admin') return void res.status(403).json({ error: 'Это действие доступно только администратору' });
  req.user = u;
  next();
}
/** administrators and moderators (news and the Discord channel list) */
export function staff(req: AuthedRequest, res: Response, next: NextFunction) {
  const u = loadUser(req);
  if (!u) return void res.status(401).json({ error: 'Требуется вход' });
  if (u.role !== 'admin' && u.role !== 'moderator') return void res.status(403).json({ error: 'Это действие доступно администратору и модератору' });
  req.user = u;
  next();
}
/**
 * What a moderator may do. Administrators may do everything; a moderator gets the permissions the administrator
 * ticked (the default set until then: news and moderation of reviews and screenshots).
 */
export const PERMS = ['news', 'moderation', 'servers', 'maintenance', 'journal'] as const;
export type Perm = (typeof PERMS)[number];
export const DEFAULT_MOD_PERMS: Perm[] = ['news', 'moderation'];

export function parsePerms(raw: string | null | undefined): Perm[] {
  if (raw == null) return [...DEFAULT_MOD_PERMS];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? PERMS.filter((p) => v.includes(p)) : [...DEFAULT_MOD_PERMS];
  } catch {
    return [...DEFAULT_MOD_PERMS];
  }
}
/** the permissions of an account: all for an administrator, the ticked ones for a moderator, none for a player */
export function permsOf(u: { id: number; role: Role }): Perm[] {
  if (u.role === 'admin') return [...PERMS];
  if (u.role !== 'moderator') return [];
  return parsePerms((db.prepare('SELECT perms FROM users WHERE id = ?').get(u.id) as { perms: string | null } | undefined)?.perms);
}
export const can = (req: Request, p: Perm): boolean => {
  const u = (req as AuthedRequest).user;
  return !!u && permsOf(u).includes(p);
};
/** administrators, and moderators with the given permission */
export function allow(p: Perm) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const u = loadUser(req);
    if (!u) return void res.status(401).json({ error: 'Требуется вход' });
    req.user = u;
    if (u.role === 'admin') return next();
    if (u.role === 'moderator' && permsOf(u).includes(p)) return next();
    res.status(403).json({ error: u.role === 'moderator' ? 'У вас нет права на это действие: его выдаёт администратор' : 'Это действие доступно администратору и модератору' });
  };
}

/** viewing: open to everyone while the panel is public, otherwise requires a sign-in */
export function viewer(req: AuthedRequest, res: Response, next: NextFunction) {
  const u = loadUser(req);
  if (u) req.user = u;
  if (!u && !publicPanel()) return void res.status(401).json({ error: 'Требуется вход' });
  next();
}

// ---------- lockout after wrong passwords for one login from one address (kept in SQLite, see loginGuard.ts) ----------
export const LOCK_AFTER = 5;
const accountKey = (ip: string | undefined, username: string) => `${ip ?? 'x'}|${username.toLowerCase()}`;

/** seconds until this login may be tried again from this address (0 = not locked) */
export function accountLockRemaining(ip: string | undefined, username: string): number {
  const f = guardGet<{ n: number; until: number }>('account', accountKey(ip, username));
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}

/** counts a wrong password; returns how many tries are left before the lockout (0 = locked now) */
export function accountLoginFailed(ip: string | undefined, username: string): number {
  const key = accountKey(ip, username);
  const now = Date.now();
  const f = guardGet<{ n: number; until: number }>('account', key) ?? { n: 0, until: 0 };
  f.n++;
  // 30 s, 1 min, 2 min ... up to 15 minutes
  if (f.n >= LOCK_AFTER) f.until = now + Math.min(15 * 60_000, 30_000 * 2 ** (f.n - LOCK_AFTER));
  // failures below the limit are forgotten 10 minutes after the last one; a lockout is remembered for an hour
  // after it ends, so the next one is longer
  guardSet('account', key, f, f.until ? f.until + 3600_000 : now + 10 * 60_000);
  return f.n >= LOCK_AFTER ? 0 : LOCK_AFTER - f.n;
}

export const accountLoginOk = (ip: string | undefined, username: string) => guardDelete('account', accountKey(ip, username));

/** a lighter per-address limit for public lookups: `max` requests per minute */
export function rateLimit(max: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  setInterval(() => { for (const [k, v] of hits) if (v.reset < Date.now()) hits.delete(k); }, 60_000).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'x';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset <= now) hits.set(key, { n: 1, reset: now + 60_000 });
    else if (++h.n > max) {
      const retryAfter = Math.max(1, Math.ceil((h.reset - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return void res.status(429).json({ error: 'Слишком много запросов. Подождите минуту.', retryAfter });
    }
    next();
  };
}

/** sign-in, registration and setup: at most 10 attempts per address in 10 minutes (a success clears the count) */
export function loginLimiter(req: Request, res: Response, next: NextFunction) {
  const key = req.ip ?? 'x';
  const now = Date.now();
  const a = guardGet<{ n: number; reset: number }>('attempts', key);
  if (a && a.reset > now && a.n >= 10) {
    const retryAfter = Math.max(1, Math.ceil((a.reset - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Слишком много попыток. Подождите 10 минут.', retryAfter });
    return;
  }
  const next_ = !a || a.reset <= now ? { n: 1, reset: now + 10 * 60 * 1000 } : { n: a.n + 1, reset: a.reset };
  guardSet('attempts', key, next_, next_.reset);
  next();
}
export const resetAttempts = (ip: string | undefined) => guardDelete('attempts', ip ?? 'x');

// ---------- the signed-in user: profile, password, sessions, Discord account ----------
export interface UserFull { id: number; username: string; role: Role; password_hash: string; no_password: number; discord_id: string | null; discord_name: string | null; discord_avatar: string | null; email?: string | null; email_verified?: number }
export const avatarUrl = (u: UserFull) => (u.discord_id && u.discord_avatar ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.discord_avatar}.png?size=64` : null);

// ---------- internal (bot only, not exposed by nginx) ----------
export function internal(req: Request, res: Response, next: NextFunction) {
  if (safeEqual(String(req.headers['x-internal-token'] ?? ''), INTERNAL_TOKEN)) return next();
  res.status(403).json({ error: 'forbidden' });
}
