/**
 * Personal profile of the signed-in user: preferences, player profile (game nick, bio), play statistics and
 * achievements derived from the player_sessions log, the account journal, the profile banner and the public profile page.
 *
 * Account journal kinds (account_events.kind):
 *   login            successful sign-in (password or Discord)
 *   login_failed     wrong password for this (known) account
 *   password_changed password changed (by the user or reset by an administrator)
 *   email_changed    e-mail address set, changed or removed
 *   discord_linked   Discord account attached
 *   discord_unlinked Discord account detached
 *   avatar_changed   avatar uploaded or removed
 *   banner_changed   banner uploaded, removed or preset chosen
 *   sessions_revoked other devices signed out / one session ended
 *   prefs_changed    language, time zone or date/time format changed
 *   profile_changed  game nick, bio or profile visibility changed
 */
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import skia from 'skia-canvas';
import { z } from 'zod';
import { DATA_DIR, db, EFFECTIVE_NAME } from './db.js';
import { nextRank, rankForHours, rankProgress, VR_RANKS } from './ranks.js';

const { Canvas, loadImage } = skia;

// ---------- account journal ----------
/** "Chrome · Windows" from a User-Agent string */
export function uaLabel(ua: string | undefined): string {
  const s = ua ?? '';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Браузер';
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad|iOS/.test(s) ? 'iOS' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

import { checkNickNow } from './nickOnboarding.js';

export type AccountEventKind =
  | 'login'
  | 'login_failed'
  | 'login_new_device'
  | 'password_changed'
  | 'email_changed'
  | 'discord_linked'
  | 'discord_unlinked'
  | 'avatar_changed'
  | 'banner_changed'
  | 'sessions_revoked'
  | 'prefs_changed'
  | 'profile_changed'
  | 'register_discord'
  | 'nick_seen';

/** Records an event in the user's own journal. Never throws. */
export function logAccount(req: Request, userId: number, kind: AccountEventKind, detail = ''): void {
  try {
    db.prepare('INSERT INTO account_events (user_id, ts, kind, ip, ua, detail) VALUES (?, ?, ?, ?, ?, ?)').run(
      userId,
      Date.now(),
      kind,
      String(req.ip ?? '').slice(0, 64),
      uaLabel(req.headers?.['user-agent']),
      detail.slice(0, 200),
    );
  } catch (e) {
    console.error('account journal failed', (e as Error).message);
  }
}

// ---------- preferences ----------
export interface Prefs {
  lang: 'ru' | 'en';
  timezone: string;
  timeFormat: '24' | '12';
  dateFormat: 'dmy' | 'mdy' | 'iso';
}

const validTz = (tz: string): boolean => {
  if (!tz) return true;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export function prefsOf(userId: number): Prefs {
  const r = db.prepare('SELECT lang, timezone, time_format, date_format FROM user_prefs WHERE user_id = ?').get(userId) as
    | { lang: string; timezone: string; time_format: string; date_format: string }
    | undefined;
  return {
    lang: r?.lang === 'en' ? 'en' : 'ru',
    timezone: r && validTz(r.timezone) ? r.timezone : '',
    timeFormat: r?.time_format === '12' ? '12' : '24',
    dateFormat: r?.date_format === 'mdy' ? 'mdy' : r?.date_format === 'iso' ? 'iso' : 'dmy',
  };
}

// ---------- banner ----------
const BANNER_DIR = path.join(DATA_DIR, 'banners');
fs.mkdirSync(BANNER_DIR, { recursive: true });
const bannerFile = (id: number) => path.join(BANNER_DIR, `${Math.trunc(id)}.jpg`);
const PRESETS = ['', 'aurora', 'sunset', 'forest', 'ocean', 'vrising', 'icarus', 'graphite'] as const;

export function bannerUrlOf(userId: number): string | null {
  try {
    return `/api/users/${Math.trunc(userId)}/banner?v=${Math.floor(fs.statSync(bannerFile(userId)).mtimeMs)}`;
  } catch {
    return null;
  }
}
export function removeBanner(userId: number): void {
  fs.rmSync(bannerFile(userId), { force: true });
}
export function bannerPresetOf(userId: number): string {
  const r = db.prepare('SELECT banner_preset FROM user_prefs WHERE user_id = ?').get(userId) as { banner_preset: string } | undefined;
  return r && (PRESETS as readonly string[]).includes(r.banner_preset) ? r.banner_preset : '';
}

// ---------- player profile ----------
interface PlayerProfile {
  gameNick: string;
  bio: string;
  publicProfile: boolean;
}
function playerOf(userId: number): PlayerProfile {
  const r = db.prepare('SELECT game_nick, bio, public_profile FROM user_player WHERE user_id = ?').get(userId) as { game_nick: string; bio: string; public_profile: number } | undefined;
  return { gameNick: r?.game_nick ?? '', bio: r?.bio ?? '', publicProfile: !!r?.public_profile };
}

// ---------- time zones ----------
const offsetCache = new Map<string, Map<number, number>>();
/** offset of the zone from UTC in ms at instant t ('' = the server's own zone) */
function tzOffset(tz: string, t: number): number {
  if (!tz) return -new Date(t).getTimezoneOffset() * 60000;
  let c = offsetCache.get(tz);
  if (!c) offsetCache.set(tz, (c = new Map()));
  const k = Math.floor(t / 3600000);
  const hit = c.get(k);
  if (hit !== undefined) return hit;
  let off = 0;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(k * 3600000));
    const g = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    off = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - k * 3600000;
  } catch {
    off = -new Date(t).getTimezoneOffset() * 60000;
  }
  if (c.size > 5000) c.clear();
  c.set(k, off);
  return off;
}

const dayKey = (localMs: number) => new Date(localMs).toISOString().slice(0, 10);
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// ---------- statistics ----------
interface SessRow {
  server_id: number;
  name: string;
  game: string;
  sname: string;
  joined_at: number;
  left_at: number | null;
}

const HOUR = 3600000;
const RETAIN_DAYS = 90;

function sessionsOf(userId: number, nick: string, since: number): SessRow[] {
  if (!nick) return [];
  return db
    .prepare(
      `SELECT ps.server_id, ps.name, s.game, ${EFFECTIVE_NAME} AS sname, ps.joined_at, ps.left_at
       FROM player_sessions ps JOIN servers s ON s.id = ps.server_id LEFT JOIN status st ON st.server_id = s.id
       WHERE ulower(ps.name) = ulower(?) AND (ps.left_at IS NULL OR ps.left_at >= ?)
       ORDER BY ps.joined_at`,
    )
    .all(nick, since) as SessRow[];
}

/** walks [a, b) in pieces that do not cross a local hour boundary */
function walk(a: number, b: number, tz: string, fn: (localStart: number, ms: number, t: number) => void): void {
  let t = a;
  let guard = 0;
  while (t < b && guard++ < 24 * 100) {
    const off = tzOffset(tz, t);
    const local = t + off;
    const next = Math.min(b, (Math.floor(local / HOUR) + 1) * HOUR - off);
    if (next <= t) break;
    fn(local, next - t, t);
    t = next;
  }
}

interface Stats {
  days: number;
  nick: string;
  totalSeconds: number;
  sessions: number;
  longestSessionSec: number;
  streakDays: number;
  lastSeenAt: number | null;
  favouriteServerId: number | null;
  byServer: { serverId: number; name: string; game: string; seconds: number; sessions: number }[];
  byDay: { date: string; seconds: number }[];
  hourly: number[];
}

function computeStats(userId: number, days: number): { stats: Stats; all: SessRow[]; tz: string; now: number } {
  const now = Date.now();
  const tz = prefsOf(userId).timezone;
  const nick = playerOf(userId).gameNick;
  const today = dayKey(now + tzOffset(tz, now));
  const startKey = addDays(today, -(days - 1));
  const winStart = Date.parse(`${startKey}T00:00:00Z`) - tzOffset(tz, now); // local midnight as UTC instant (DST jitter is irrelevant here)

  const all = sessionsOf(userId, nick, now - RETAIN_DAYS * 86400000);
  const byDayMap = new Map<string, number>();
  for (let i = 0; i < days; i++) byDayMap.set(addDays(startKey, i), 0);
  const hourly = new Array<number>(24).fill(0);
  const allDays = new Set<string>();
  const srv = new Map<number, { serverId: number; name: string; game: string; ms: number; sessions: number }>();
  let totalMs = 0;
  let sessions = 0;
  let longest = 0;
  let lastSeen: number | null = null;

  for (const s of all) {
    const end = s.left_at ?? now;
    if (end <= s.joined_at) continue;
    const a = s.joined_at;
    lastSeen = Math.max(lastSeen ?? 0, end);
    walk(a, end, tz, (local, ms, t) => {
      const k = dayKey(local);
      allDays.add(k);
      if (t >= winStart) {
        if (byDayMap.has(k)) byDayMap.set(k, (byDayMap.get(k) ?? 0) + ms);
        hourly[new Date(local).getUTCHours()] += ms;
      }
    });
    if (end <= winStart) continue;
    const from = Math.max(a, winStart);
    const ms = end - from;
    totalMs += ms;
    sessions++;
    longest = Math.max(longest, end - a);
    const cur = srv.get(s.server_id) ?? { serverId: s.server_id, name: s.sname, game: s.game, ms: 0, sessions: 0 };
    cur.ms += ms;
    cur.sessions++;
    srv.set(s.server_id, cur);
  }

  let streak = 0;
  let k = allDays.has(today) ? today : addDays(today, -1);
  while (allDays.has(k)) {
    streak++;
    k = addDays(k, -1);
  }
  const byServer = [...srv.values()]
    .sort((x, y) => y.ms - x.ms)
    .map((x) => ({ serverId: x.serverId, name: x.name, game: x.game, seconds: Math.round(x.ms / 1000), sessions: x.sessions }));

  return {
    all,
    tz,
    now,
    stats: {
      days,
      nick,
      totalSeconds: Math.round(totalMs / 1000),
      sessions,
      longestSessionSec: Math.round(longest / 1000),
      streakDays: streak,
      lastSeenAt: lastSeen,
      favouriteServerId: byServer[0]?.serverId ?? null,
      byServer,
      byDay: [...byDayMap].map(([date, ms]) => ({ date, seconds: Math.round(ms / 1000) })),
      hourly: hourly.map((ms) => Math.round(ms / 1000)),
    },
  };
}

// ---------- achievements ----------
interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  earned: boolean;
  progress: number;
  target: number;
  earnedAt: number | null;
}

export type { Achievement };

/**
 * The achievements earned by playing (hours, streaks, night and morning sessions, servers), from the visits of one
 * player. Shared by the account's profile and the public card of any nick.
 */
export function playAchievements(visits: { server_id: number; joined_at: number; left_at: number | null }[], tz: string, now = Date.now()): Achievement[] {
  const sess = visits.filter((s) => (s.left_at ?? now) > s.joined_at).sort((x, y) => x.joined_at - y.joined_at);

  let totalMs = 0;
  let longestMs = 0;
  let firstAt: number | null = null;
  let nightAt: number | null = null;
  let earlyAt: number | null = null;
  let marathonAt: number | null = null;
  let h10At: number | null = null;
  let h100At: number | null = null;
  const perServer = new Map<number, number>();
  const dayEnd = new Map<string, number>(); // local day -> last instant played on it
  for (const s of sess) {
    const end = s.left_at ?? now;
    const dur = end - s.joined_at;
    const before = totalMs;
    totalMs += dur;
    if (h10At === null && totalMs >= 10 * HOUR) h10At = s.joined_at + Math.max(0, 10 * HOUR - before);
    if (h100At === null && totalMs >= 100 * HOUR) h100At = s.joined_at + Math.max(0, 100 * HOUR - before);
    longestMs = Math.max(longestMs, dur);
    if (marathonAt === null && dur >= 4 * HOUR) marathonAt = s.joined_at + 4 * HOUR;
    firstAt ??= s.joined_at;
    perServer.set(s.server_id, (perServer.get(s.server_id) ?? 0) + dur);
    // local 03:00 inside the session, and a start between 05:00 and 08:00
    const off = tzOffset(tz, s.joined_at);
    const startLocal = s.joined_at + off;
    const startHour = new Date(startLocal).getUTCHours();
    if (earlyAt === null && startHour >= 5 && startHour < 8) earlyAt = s.joined_at;
    if (nightAt === null) {
      const dayStart = Math.floor(startLocal / 86400000) * 86400000;
      let three = dayStart + 3 * HOUR;
      if (three <= startLocal) three += 86400000;
      if (three - off < end) nightAt = s.joined_at;
    }
    walk(s.joined_at, end, tz, (local, _ms, t) => {
      const k = dayKey(local);
      dayEnd.set(k, Math.max(dayEnd.get(k) ?? 0, t + _ms));
    });
  }
  const hours = totalMs / HOUR;
  const topMs = Math.max(0, ...perServer.values());
  const share = totalMs > 0 ? topMs / totalMs : 0;

  // best run of consecutive days with play
  const keys = [...dayEnd.keys()].sort();
  let best = 0;
  let run = 0;
  let prev = '';
  let at3: number | null = null;
  let at7: number | null = null;
  for (const k of keys) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    prev = k;
    best = Math.max(best, run);
    if (run === 3 && at3 === null) at3 = dayEnd.get(k) ?? null;
    if (run === 7 && at7 === null) at7 = dayEnd.get(k) ?? null;
  }

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const domosedEarned = share >= 0.8 && hours >= 10;

  return [
    mk('first-step', 'Первый шаг', 'Проведите первую игровую сессию на отслеживаемом сервере', 'star', Math.min(sess.length, 1), 1, firstAt),
    mk('hours-10', '10 часов', 'Наиграйте 10 часов суммарно', 'clock', r1(hours), 10, h10At),
    mk('hours-100', '100 часов', 'Наиграйте 100 часов суммарно', 'clock', r1(hours), 100, h100At),
    mk('night-shift', 'Ночная смена', 'Играйте так, чтобы сессия пересекла 03:00', 'moon', nightAt ? 1 : 0, 1, nightAt),
    mk('early-bird', 'Ранняя пташка', 'Зайдите в игру между 05:00 и 08:00', 'sun', earlyAt ? 1 : 0, 1, earlyAt),
    mk('streak-3', 'Серия 3 дня', 'Играйте 3 дня подряд', 'flame', Math.min(best, 3), 3, at3),
    mk('streak-7', 'Серия 7 дней', 'Играйте 7 дней подряд', 'flame', Math.min(best, 7), 7, at7),
    mk('homebody', 'Домосед', 'Проведите 80% времени на одном сервере (не менее 10 часов всего)', 'heart', domosedEarned ? 100 : Math.min(99, Math.round(share * 100)), 100, domosedEarned ? now : null),
    mk('traveller', 'Путешественник', 'Поиграйте на 3 разных серверах', 'server', perServer.size, 3, perServer.size >= 3 ? now : null),
    mk('marathon', 'Марафонец', 'Одна сессия длиннее 4 часов', 'crown', r1(longestMs / HOUR), 4, marathonAt),
  ];
}

export const mk = (id: string, title: string, description: string, icon: string, progress: number, target: number, earnedAt: number | null = null): Achievement => {
  const earned = progress >= target;
  return { id, title, description, icon, earned, progress: Math.min(progress, target), target, earnedAt: earned ? earnedAt : null };
};

export function achievementsOf(userId: number): Achievement[] {
  const nick = playerOf(userId).gameNick;
  const now = Date.now();
  const tz = prefsOf(userId).timezone;
  const play = playAchievements(sessionsOf(userId, nick, now - RETAIN_DAYS * 86400000), tz, now);
  const u = db.prepare('SELECT email, no_password, discord_id FROM users WHERE id = ?').get(userId) as { email: string | null; no_password: number; discord_id: string | null } | undefined;
  const hasAvatar = fs.existsSync(path.join(DATA_DIR, 'avatars', `${userId}.png`)) || !!db.prepare('SELECT 1 FROM users WHERE id = ? AND discord_avatar IS NOT NULL').get(userId);
  const profileParts = [hasAvatar, !!u?.email, !!nick].filter(Boolean).length;
  const protectedParts = [!u?.no_password, !!u?.email, !!u?.discord_id].filter(Boolean).length;
  return [
    ...play,
    mk('profile-complete', 'Профиль заполнен', 'Аватар, электронная почта и игровой ник', 'calendar', profileParts, 3),
    mk('secured', 'Защищён', 'Пароль, электронная почта и привязанный Discord', 'shield', protectedParts, 3),
  ];
}

// ---------- V Rising: rank ladder and achievements ----------
db.exec('CREATE TABLE IF NOT EXISTS vr_rank_max (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, hours REAL NOT NULL DEFAULT 0)');

interface VrSess { server_id: number; joined_at: number; left_at: number | null }

/** sessions of a nick on servers whose game id is vrising (the log keeps 90 days) */
function vrSessionsOf(nick: string): VrSess[] {
  if (!nick) return [];
  return db
    .prepare(
      `SELECT ps.server_id, ps.joined_at, ps.left_at FROM player_sessions ps JOIN servers s ON s.id = ps.server_id
       WHERE s.game = 'vrising' AND ulower(ps.name) = ulower(?) ORDER BY ps.joined_at`,
    )
    .all(nick) as VrSess[];
}

/** hours of play on vrising servers; never goes down (the best value seen is remembered, the log is pruned after 90 days) */
export function vrHoursOf(userId: number, nick: string): { hours: number; sessions: number } {
  if (!nick) return { hours: 0, sessions: 0 };
  const now = Date.now();
  const sess = vrSessionsOf(nick).filter((s) => (s.left_at ?? now) > s.joined_at);
  const cur = sess.reduce((a, s) => a + ((s.left_at ?? now) - s.joined_at), 0) / HOUR;
  const row = db.prepare('SELECT hours FROM vr_rank_max WHERE user_id = ?').get(userId) as { hours: number } | undefined;
  const hours = Math.max(cur, row?.hours ?? 0);
  if (hours > (row?.hours ?? 0) + 0.01) {
    db.prepare('INSERT INTO vr_rank_max (user_id, hours) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET hours = excluded.hours').run(userId, hours);
  }
  return { hours, sessions: sess.length };
}

export interface VrAchievement extends Achievement {
  game: 'vrising';
  image: string;
}

export function vrAchievementsOf(userId: number): VrAchievement[] {
  const nick = playerOf(userId).gameNick;
  const now = Date.now();
  const tz = prefsOf(userId).timezone;
  const sess = vrSessionsOf(nick).filter((s) => (s.left_at ?? now) > s.joined_at);
  const rankHours = vrHoursOf(userId, nick).hours;

  let totalMs = 0;
  let longestMs = 0;
  let firstAt: number | null = null;
  let nightAt: number | null = null;
  let sunAt: number | null = null;
  let sleeplessAt: number | null = null;
  let dawnAt: number | null = null;
  let crowdAt: number | null = null;
  let h100At: number | null = null;
  let h400At: number | null = null;
  let n50At: number | null = null;
  let count = 0;
  const perServer = new Map<number, number>();
  const dayEnd = new Map<string, number>();
  const dayMs = new Map<string, number>();
  const maxOf = new Map<number, number>();
  const crossing = (s: VrSess, end: number, hour: number): boolean => {
    const off = tzOffset(tz, s.joined_at);
    const startLocal = s.joined_at + off;
    let at = Math.floor(startLocal / 86400000) * 86400000 + hour * HOUR;
    if (at < startLocal) at += 86400000;
    return at - off < end;
  };
  for (const s of sess) {
    const end = s.left_at ?? now;
    const dur = end - s.joined_at;
    const before = totalMs;
    totalMs += dur;
    count++;
    if (h100At === null && totalMs >= 100 * HOUR) h100At = s.joined_at + Math.max(0, 100 * HOUR - before);
    if (h400At === null && totalMs >= 400 * HOUR) h400At = s.joined_at + Math.max(0, 400 * HOUR - before);
    if (n50At === null && count >= 50) n50At = s.joined_at;
    longestMs = Math.max(longestMs, dur);
    if (sleeplessAt === null && dur >= 6 * HOUR) sleeplessAt = s.joined_at + 6 * HOUR;
    firstAt ??= s.joined_at;
    perServer.set(s.server_id, (perServer.get(s.server_id) ?? 0) + dur);
    if (nightAt === null && crossing(s, end, 3)) nightAt = s.joined_at;
    if (sunAt === null && crossing(s, end, 12)) sunAt = s.joined_at;
    if (dawnAt === null && s.left_at !== null) {
      const h = new Date(end + tzOffset(tz, end)).getUTCHours();
      if (h === 5) dawnAt = end;
    }
    if (crowdAt === null) {
      let max = maxOf.get(s.server_id);
      if (max === undefined) {
        max = (db.prepare('SELECT max_players FROM status WHERE server_id = ?').get(s.server_id) as { max_players: number } | undefined)?.max_players ?? 0;
        maxOf.set(s.server_id, max);
      }
      if (max > 0) {
        const h = db
          .prepare('SELECT players FROM history WHERE server_id = ? AND ts BETWEEN ? AND ? ORDER BY ABS(ts - ?) LIMIT 1')
          .get(s.server_id, s.joined_at - 10 * 60000, s.joined_at + 10 * 60000, s.joined_at) as { players: number } | undefined;
        if (h && h.players / max >= 0.9) crowdAt = s.joined_at;
      }
    }
    walk(s.joined_at, end, tz, (local, ms, t) => {
      const k = dayKey(local);
      dayEnd.set(k, Math.max(dayEnd.get(k) ?? 0, t + ms));
      dayMs.set(k, (dayMs.get(k) ?? 0) + ms);
    });
  }
  const hours = totalMs / HOUR;
  const share = totalMs > 0 ? Math.max(0, ...perServer.values()) / totalMs : 0;
  const bestDayMs = Math.max(0, ...dayMs.values());
  let longDayAt: number | null = null;
  if (bestDayMs >= 12 * HOUR) {
    const k = [...dayMs].find(([, v]) => v >= 12 * HOUR)?.[0];
    longDayAt = k ? (dayEnd.get(k) ?? null) : null;
  }

  const keys = [...dayEnd.keys()].sort();
  let best = 0;
  let run = 0;
  let prev = '';
  let at7: number | null = null;
  let at30: number | null = null;
  for (const k of keys) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    prev = k;
    best = Math.max(best, run);
    if (run === 7 && at7 === null) at7 = dayEnd.get(k) ?? null;
    if (run === 30 && at30 === null) at30 = dayEnd.get(k) ?? null;
  }

  const u = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId) as { created_at: number | null } | undefined;
  const first = (db.prepare('SELECT MIN(created_at) AS m FROM users WHERE created_at IS NOT NULL').get() as { m: number | null }).m;
  const founder = !!u?.created_at && first !== null && u.created_at - first <= 30 * 86400000;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const mk = (id: string, title: string, description: string, icon: string, progress: number, target: number, earnedAt: number | null = null): VrAchievement => {
    const earned = progress >= target;
    return { id, title, description, icon, earned, progress: Math.min(progress, target), target, earnedAt: earned ? earnedAt : null, game: 'vrising', image: `/vrising/achievements/${id}.png` };
  };
  const loyal = share >= 0.8 && hours >= 20;
  const crowned = rankHours >= VR_RANKS[VR_RANKS.length - 1]!.minHours;

  return [
    mk('vr-first-bite', 'Первый укус', 'Проведите первую сессию на сервере V Rising', 'star', Math.min(count, 1), 1, firstAt),
    mk('vr-night-hunter', 'Ночной охотник', 'Играйте так, чтобы сессия пересекла 03:00', 'moon', nightAt ? 1 : 0, 1, nightAt),
    mk('vr-sun-defier', 'Не боюсь солнца', 'Сессия, охватывающая полдень (12:00)', 'sun', sunAt ? 1 : 0, 1, sunAt),
    mk('vr-sleepless', 'Бессонная ночь', 'Одна сессия длиннее 6 часов', 'clock', r1(longestMs / HOUR), 6, sleeplessAt),
    mk('vr-blood-bond', 'Кровная связь', 'Играйте 7 дней подряд', 'flame', Math.min(best, 7), 7, at7),
    mk('vr-eternal', 'Вечный', 'Играйте 30 дней подряд', 'flame', Math.min(best, 30), 30, at30),
    mk('vr-castle-warden', 'Хранитель замка', 'Наиграйте 100 часов в V Rising', 'shield', r1(hours), 100, h100At),
    mk('vr-elder', 'Древний вампир', 'Наиграйте 400 часов в V Rising', 'crown', r1(hours), 400, h400At),
    mk('vr-two-realms', 'Владыка двух миров', 'Поиграйте минимум на 2 разных серверах V Rising', 'server', perServer.size, 2, perServer.size >= 2 ? now : null),
    mk('vr-loyal', 'Верный сервер', 'Проведите 80% времени на одном сервере (не менее 20 часов)', 'heart', loyal ? 100 : Math.min(99, Math.round(share * 100)), 100, loyal ? now : null),
    mk('vr-veteran-nights', '50 ночей', 'Проведите 50 игровых сессий', 'calendar', Math.min(count, 50), 50, n50At),
    mk('vr-long-haul', 'Бессмертный марафон', 'Играйте 12 часов за один календарный день', 'clock', r1(Math.min(bestDayMs, 12 * HOUR) / HOUR), 12, longDayAt),
    mk('vr-dawn-escape', 'Бегущий от рассвета', 'Закончите сессию между 05:00 и 06:00', 'sun', dawnAt ? 1 : 0, 1, dawnAt),
    mk('vr-crowd-lord', 'Лорд толпы', 'Зайдите на сервер, когда он заполнен на 90% и больше', 'server', crowdAt ? 1 : 0, 1, crowdAt),
    mk('vr-founder', 'Основатель', 'Аккаунт создан в первые 30 дней работы панели', 'star', founder ? 1 : 0, 1, founder ? (u?.created_at ?? null) : null),
    mk('vr-crowned', 'Коронованный', 'Достигните ранга «Первородный»', 'crown', crowned ? 1 : 0, 1, crowned ? now : null),
  ];
}

// ---------- public ranks of the players currently on a server ----------
let rankCache: { at: number; map: Map<string, number> } | null = null;
/** lower(name) -> hours of play on vrising servers, cached for 60 s */
export function vrHoursByName(): Map<string, number> {
  const now = Date.now();
  if (rankCache && now - rankCache.at < 60_000) return rankCache.map;
  const rows = db
    .prepare(
      `SELECT ulower(ps.name) AS n, SUM(COALESCE(ps.left_at, ?) - ps.joined_at) AS ms
       FROM player_sessions ps JOIN servers s ON s.id = ps.server_id
       WHERE s.game = 'vrising' AND COALESCE(ps.left_at, ?) > ps.joined_at GROUP BY ulower(ps.name)`,
    )
    .all(now, now) as { n: string; ms: number }[];
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.n, r.ms / HOUR);
  rankCache = { at: now, map };
  return map;
}
export function vrRankIdFor(name: string): string {
  return rankForHours(vrHoursByName().get(name.toLowerCase()) ?? 0).id;
}

// ---------- activity text ----------
function fmtDur(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 1) return 'меньше минуты';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? (mm ? `${h} ч ${mm} мин` : `${h} ч`) : `${mm} мин`;
}

const EVENT_TEXT: Record<string, string> = {
  login: 'Вход в аккаунт',
  login_failed: 'Неудачная попытка входа',
  password_changed: 'Пароль изменён',
  email_changed: 'Электронная почта изменена',
  discord_linked: 'Привязан Discord',
  discord_unlinked: 'Discord отвязан',
  avatar_changed: 'Изменён аватар',
  banner_changed: 'Изменена обложка профиля',
  sessions_revoked: 'Завершены сеансы на других устройствах',
  prefs_changed: 'Изменены настройки интерфейса',
  profile_changed: 'Изменён игровой профиль',
  register_discord: 'Регистрация через Discord',
  nick_seen: 'Ник найден на сервере',
};

// ---------- routes ----------
export function registerProfile(deps: {
  app: Express;
  auth: RequestHandler;
  rateLimit: (max: number) => (req: Request, res: Response, next: NextFunction) => void;
  userId: (req: Request) => number;
  /** avatar URL of a user (uploaded picture or Discord), or null */
  avatarOf: (userId: number) => string | null;
}): void {
  const { app, auth, userId, avatarOf } = deps;

  // preferences
  app.get('/api/me/prefs', auth, (req, res) => res.json(prefsOf(userId(req))));
  app.put('/api/me/prefs', auth, (req, res) => {
    const cur = prefsOf(userId(req));
    const b = z
      .object({
        lang: z.enum(['ru', 'en']).optional(),
        timezone: z.string().trim().max(64).optional(),
        timeFormat: z.enum(['24', '12']).optional(),
        dateFormat: z.enum(['dmy', 'mdy', 'iso']).optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте настройки' });
    const next: Prefs = { ...cur, ...Object.fromEntries(Object.entries(b.data).filter(([, v]) => v !== undefined)) } as Prefs;
    if (!validTz(next.timezone)) return res.status(400).json({ error: 'Неизвестный часовой пояс' });
    db.prepare(
      `INSERT INTO user_prefs (user_id, lang, timezone, time_format, date_format, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET lang = excluded.lang, timezone = excluded.timezone, time_format = excluded.time_format, date_format = excluded.date_format, updated_at = excluded.updated_at`,
    ).run(userId(req), next.lang, next.timezone, next.timeFormat, next.dateFormat, Date.now());
    if (JSON.stringify(cur) !== JSON.stringify(next)) logAccount(req, userId(req), 'prefs_changed');
    res.json(next);
  });

  // player profile
  app.get('/api/me/player', auth, (req, res) => res.json(playerOf(userId(req))));
  app.put('/api/me/player', auth, (req, res) => {
    const cur = playerOf(userId(req));
    const b = z
      .object({
        gameNick: z.string().trim().max(40).optional(),
        bio: z.string().trim().max(200).optional(),
        publicProfile: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Ник — до 40 символов, о себе — до 200' });
    const next: PlayerProfile = {
      gameNick: (b.data.gameNick ?? cur.gameNick).replace(/[\u0000-\u001f]/g, ' ').trim(),
      bio: (b.data.bio ?? cur.bio).replace(/[\u0000-\u0009\u000b-\u001f]/g, ' '),
      publicProfile: b.data.publicProfile ?? cur.publicProfile,
    };
    db.prepare(
      `INSERT INTO user_player (user_id, game_nick, bio, public_profile) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET game_nick = excluded.game_nick, bio = excluded.bio, public_profile = excluded.public_profile`,
    ).run(userId(req), next.gameNick, next.bio, next.publicProfile ? 1 : 0);
    if (JSON.stringify(cur) !== JSON.stringify(next)) logAccount(req, userId(req), 'profile_changed');
    if (next.gameNick !== cur.gameNick) checkNickNow(userId(req), next.gameNick);
    res.json(next);
  });

  app.get('/api/me/stats', auth, (req, res) => {
    const d = Math.trunc(Number(req.query.days ?? 30));
    const days = Number.isFinite(d) ? Math.min(90, Math.max(1, d)) : 30;
    res.json(computeStats(userId(req), days).stats);
  });

  app.get('/api/me/achievements', auth, (req, res) => res.json(achievementsOf(userId(req))));
  app.get('/api/me/achievements/vrising', auth, (req, res) => res.json(vrAchievementsOf(userId(req))));
  app.get('/api/me/rank', auth, (req, res) => {
    const nick = playerOf(userId(req)).gameNick;
    const { hours, sessions } = vrHoursOf(userId(req), nick);
    const pick = (r: { id: string; name: string; minHours: number; color: string; image: string }) => ({ id: r.id, name: r.name, minHours: r.minHours, color: r.color, image: r.image });
    const nx = nextRank(hours);
    res.json({
      game: 'vrising',
      hours: Math.round(hours * 10) / 10,
      rank: pick(rankForHours(hours)),
      next: nx ? pick(nx) : null,
      progress: Math.round(rankProgress(hours) * 1000) / 1000,
      sessions,
      nick,
    });
  });

  app.get('/api/me/activity', auth, (req, res) => {
    const id = userId(req);
    const l = Math.trunc(Number(req.query.limit ?? 30));
    const limit = Number.isFinite(l) ? Math.min(100, Math.max(1, l)) : 30;
    const now = Date.now();
    const nick = playerOf(id).gameNick;
    const out: { ts: number; kind: 'session' | 'account'; text: string }[] = [];
    if (nick) {
      const rows = db
        .prepare(
          `SELECT ${EFFECTIVE_NAME} AS sname, ps.joined_at, ps.left_at
           FROM player_sessions ps JOIN servers s ON s.id = ps.server_id LEFT JOIN status st ON st.server_id = s.id
           WHERE ulower(ps.name) = ulower(?) ORDER BY ps.joined_at DESC LIMIT ?`,
        )
        .all(nick, limit) as { sname: string; joined_at: number; left_at: number | null }[];
      for (const r of rows) {
        const end = r.left_at ?? now;
        out.push({ ts: end, kind: 'session', text: `${r.left_at === null ? 'Играете' : 'Играли'} на ${r.sname} ${fmtDur((end - r.joined_at) / 1000)}` });
      }
    }
    const ev = db.prepare('SELECT ts, kind, detail FROM account_events WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?').all(id, limit) as { ts: number; kind: string; detail: string }[];
    for (const e of ev) out.push({ ts: e.ts, kind: 'account', text: (EVENT_TEXT[e.kind] ?? e.kind) + (e.detail ? ` (${e.detail})` : '') });
    out.sort((a, b) => b.ts - a.ts);
    res.json(out.slice(0, limit));
  });

  app.get('/api/me/journal', auth, (req, res) => {
    const l = Math.trunc(Number(req.query.limit ?? 50));
    const limit = Number.isFinite(l) ? Math.min(200, Math.max(1, l)) : 50;
    res.json(db.prepare('SELECT id, ts, kind, ip, ua, detail FROM account_events WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?').all(userId(req), limit));
  });

  // banner
  app.put('/api/me/banner', auth, express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '4mb' }), async (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'Нужна картинка PNG, JPG или WebP до 4 МБ' });
    try {
      const img = await loadImage(body);
      if (!img.width || !img.height || img.width > 10000 || img.height > 10000) throw new Error('size');
      const W = 1200;
      const H = 400;
      // cover: scale to fill, centre crop
      const k = Math.max(W / img.width, H / img.height);
      const sw = W / k;
      const sh = H / k;
      const canvas = new Canvas(W, H);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, H);
      fs.writeFileSync(bannerFile(userId(req)), await canvas.toBuffer('jpeg', { quality: 0.85 }), { mode: 0o644 });
      logAccount(req, userId(req), 'banner_changed', 'загружена картинка');
      res.json({ bannerUrl: bannerUrlOf(userId(req)) });
    } catch {
      res.status(400).json({ error: 'Не удалось прочитать картинку: выберите PNG, JPG или WebP' });
    }
  });
  app.delete('/api/me/banner', auth, (req, res) => {
    removeBanner(userId(req));
    logAccount(req, userId(req), 'banner_changed', 'картинка убрана');
    res.json({ ok: true });
  });
  app.get('/api/users/:id/banner', (req, res) => {
    const m = /^\d{1,9}$/.exec(String(req.params.id));
    if (!m) return res.status(404).end();
    const f = bannerFile(Number(m[0]));
    if (!fs.existsSync(f)) return res.status(404).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(fs.readFileSync(f));
  });
  app.put('/api/me/banner-preset', auth, (req, res) => {
    const b = z.object({ preset: z.enum(PRESETS) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Неизвестный фон' });
    db.prepare(
      `INSERT INTO user_prefs (user_id, banner_preset, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET banner_preset = excluded.banner_preset, updated_at = excluded.updated_at`,
    ).run(userId(req), b.data.preset, Date.now());
    logAccount(req, userId(req), 'banner_changed', b.data.preset ? `фон «${b.data.preset}»` : 'фон сброшен');
    res.json({ bannerPreset: b.data.preset });
  });

  // public profile (only when the user switched it on)
  app.get('/api/u/:username', deps.rateLimit(60), (req, res) => {
    const name = String(req.params.username ?? '').trim().toLowerCase();
    const u = db.prepare("SELECT id, username, role, created_at FROM users WHERE ulower(username) = ? AND status = 'active'").get(name) as
      | { id: number; username: string; role: string; created_at: number | null }
      | undefined;
    const p = u ? playerOf(u.id) : null;
    if (!u || !p || !p.publicProfile) return res.status(404).json({ error: 'Профиль не найден или скрыт' });
    const { stats } = computeStats(u.id, RETAIN_DAYS);
    res.json({
      username: u.username,
      role: u.role,
      avatarUrl: avatarOf(u.id),
      bannerUrl: bannerUrlOf(u.id),
      bannerPreset: bannerPresetOf(u.id),
      gameNick: p.gameNick,
      bio: p.bio,
      memberSince: u.created_at,
      stats: {
        totalSeconds: stats.totalSeconds,
        sessions: stats.sessions,
        streakDays: stats.streakDays,
        favouriteServerName: stats.byServer[0]?.name ?? null,
      },
      achievements: achievementsOf(u.id)
        .filter((a) => a.earned)
        .map((a) => ({ id: a.id, title: a.title, icon: a.icon })),
      rank: (() => {
        const r = rankForHours(vrHoursOf(u.id, p.gameNick).hours);
        return { id: r.id, name: r.name, color: r.color, image: r.image };
      })(),
      vrAchievements: vrAchievementsOf(u.id)
        .filter((a) => a.earned)
        .map((a) => ({ id: a.id, title: a.title, image: a.image })),
    });
  });
}
