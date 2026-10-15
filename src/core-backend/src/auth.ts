/** Sessions, roles and the access middleware; login rate limits and lockout. */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { INTERNAL_TOKEN, JWT_SECRET } from './config.js';
import { db, getSetting } from './db.js';
import { safeEqual } from './http.js';
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
/** viewing: open to everyone while the panel is public, otherwise requires a sign-in */
export function viewer(req: AuthedRequest, res: Response, next: NextFunction) {
  const u = loadUser(req);
  if (u) req.user = u;
  if (!u && !publicPanel()) return void res.status(401).json({ error: 'Требуется вход' });
  next();
}

export const LOCK_AFTER = 5;
export const fails = new Map<string, { n: number; until: number }>();
setInterval(() => { for (const [k, v] of fails) if (v.until < Date.now() - 3600_000) fails.delete(k); }, 600_000).unref();

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

export const attempts = new Map<string, { n: number; reset: number }>();
export function loginLimiter(req: Request, res: Response, next: NextFunction) {
  const key = req.ip ?? 'x';
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.reset > now && a.n >= 10) {
    const retryAfter = Math.max(1, Math.ceil((a.reset - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Слишком много попыток. Подождите 10 минут.', retryAfter });
    return;
  }
  if (!a || a.reset <= now) attempts.set(key, { n: 1, reset: now + 10 * 60 * 1000 });
  else a.n++;
  next();
}

// ---------- the signed-in user: profile, password, sessions, Discord account ----------
export interface UserFull { id: number; username: string; role: Role; password_hash: string; no_password: number; discord_id: string | null; discord_name: string | null; discord_avatar: string | null; email?: string | null; email_verified?: number }
export const avatarUrl = (u: UserFull) => (u.discord_id && u.discord_avatar ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.discord_avatar}.png?size=64` : null);

// ---------- internal (bot only, not exposed by nginx) ----------
export function internal(req: Request, res: Response, next: NextFunction) {
  if (safeEqual(String(req.headers['x-internal-token'] ?? ''), INTERNAL_TOKEN)) return next();
  res.status(403).json({ error: 'forbidden' });
}
