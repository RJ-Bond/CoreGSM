/** Profile core: preferences, the player profile, time zones and play statistics. */
import { db, EFFECTIVE_NAME } from './db.js';

// ---------- preferences ----------
export interface Prefs {
  lang: 'ru' | 'en';
  timezone: string;
  timeFormat: '24' | '12';
  dateFormat: 'dmy' | 'mdy' | 'iso';
}

export const validTz = (tz: string): boolean => {
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

// ---------- player profile ----------
export interface PlayerProfile {
  gameNick: string;
  bio: string;
  publicProfile: boolean;
}
export function playerOf(userId: number): PlayerProfile {
  const r = db.prepare('SELECT game_nick, bio, public_profile FROM user_player WHERE user_id = ?').get(userId) as { game_nick: string; bio: string; public_profile: number } | undefined;
  return { gameNick: r?.game_nick ?? '', bio: r?.bio ?? '', publicProfile: !!r?.public_profile };
}

// ---------- time zones ----------
const offsetCache = new Map<string, Map<number, number>>();
/** offset of the zone from UTC in ms at instant t ('' = the server's own zone) */
export function tzOffset(tz: string, t: number): number {
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

export const dayKey = (localMs: number) => new Date(localMs).toISOString().slice(0, 10);
export const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// ---------- statistics ----------
export interface SessRow {
  server_id: number;
  name: string;
  game: string;
  sname: string;
  joined_at: number;
  left_at: number | null;
}

export const HOUR = 3600000;
export const RETAIN_DAYS = 90;

export function sessionsOf(userId: number, nick: string, since: number): SessRow[] {
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
export function walk(a: number, b: number, tz: string, fn: (localStart: number, ms: number, t: number) => void): void {
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

export interface Stats {
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

export function computeStats(userId: number, days: number): { stats: Stats; all: SessRow[]; tz: string; now: number } {
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

