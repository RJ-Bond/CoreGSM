/**
 * The moderation of the game plugin in the database: the log of what administrators did (kick, ban, warning, unban), the bans that are
 * in force (also the short «do not come back for N minutes» after a kick) and the commands that the panel gives to the plugin.
 * No answers for people here: only what is kept and counted.
 */
import { db } from '../db.js';
import { formatLeft } from './gameNewsRestartLogic.js';

export type ModKind = 'kick' | 'ban' | 'warn' | 'unban';

export interface ModEntry {
  id: number;
  ts: number;
  kind: ModKind;
  platform_id: string;
  nick: string;
  admin: string;
  reason: string;
  server_id: number;
  /** a ban: until when (0 = for ever) */
  until: number;
}

export function logMod(e: { kind: ModKind; platformId: string; nick: string; admin: string; reason: string; serverId: number; until?: number }, now: number): number {
  const info = db.prepare('INSERT INTO game_mod_log (ts, kind, platform_id, nick, admin, reason, server_id, until) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(now, e.kind, e.platformId, e.nick.slice(0, 100), e.admin.slice(0, 100), e.reason.slice(0, 300), e.serverId, e.until ?? 0);
  db.prepare('DELETE FROM game_mod_log WHERE id NOT IN (SELECT id FROM game_mod_log ORDER BY id DESC LIMIT 2000)').run();
  return Number(info.lastInsertRowid);
}

export function recentMod(opts: { player?: string; kind?: string; limit?: number }): ModEntry[] {
  const limit = Math.min(300, Math.max(1, opts.limit ?? 100));
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.kind && ['kick', 'ban', 'warn', 'unban'].includes(opts.kind)) { where.push('kind = ?'); args.push(opts.kind); }
  const p = (opts.player ?? '').trim().toLowerCase();
  if (p) { where.push('(ulower(nick) LIKE ? OR platform_id = ?)'); args.push(`%${p}%`, p); }
  return db.prepare(`SELECT * FROM game_mod_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...args, limit) as ModEntry[];
}

/** who was kicked, warned and banned most: the counters of a player, for the page of moderation */
export function topPlayers(limit = 12): { nick: string; platformId: string; kicks: number; warns: number; bans: number; last: number }[] {
  const rows = db.prepare(
    `SELECT platform_id, MAX(nick) AS nick, SUM(kind = 'kick') AS kicks, SUM(kind = 'warn') AS warns, SUM(kind = 'ban') AS bans, MAX(ts) AS last
     FROM game_mod_log WHERE kind IN ('kick', 'warn', 'ban') GROUP BY platform_id ORDER BY (SUM(kind = 'kick') + SUM(kind = 'warn') + SUM(kind = 'ban')) DESC, last DESC LIMIT ?`,
  ).all(limit) as { platform_id: string; nick: string; kicks: number; warns: number; bans: number; last: number }[];
  return rows.map((r) => ({ nick: r.nick, platformId: r.platform_id, kicks: r.kicks, warns: r.warns, bans: r.bans, last: r.last }));
}

export function countMod(platformId: string, kind: ModKind, since = 0): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM game_mod_log WHERE platform_id = ? AND kind = ? AND ts >= ?').get(platformId, kind, since) as { n: number }).n;
}

// ---- bans
export interface BanRow {
  platform_id: string;
  nick: string;
  reason: string;
  admin: string;
  created_at: number;
  until: number;
  /** ban | block (a short block after a kick) */
  kind: string;
  server_id: number;
  /** all | server: where the ban holds */
  scope: string;
}

/** puts a ban in force (replaces the one the player has; a ban is not shortened by a short block) */
export function putBan(b: { platformId: string; nick: string; reason: string; admin: string; until: number; kind: 'ban' | 'block'; serverId: number; scope?: 'all' | 'server' }, now: number): void {
  const old = activeBan(b.platformId, now);
  if (old && b.kind === 'block' && old.kind === 'ban') return;
  db.prepare(
    `INSERT INTO game_bans (platform_id, nick, reason, admin, created_at, until, kind, server_id, scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(platform_id) DO UPDATE SET nick = excluded.nick, reason = excluded.reason, admin = excluded.admin, created_at = excluded.created_at,
       until = excluded.until, kind = excluded.kind, server_id = excluded.server_id, scope = excluded.scope`,
  ).run(b.platformId, b.nick.slice(0, 100), b.reason.slice(0, 300), b.admin.slice(0, 100), now, b.until, b.kind, b.serverId, b.scope ?? 'all');
}

/** does a ban hold on this server (a ban of one server does not hold on the others; serverId undefined = look at all) */
export const holdsOn = (r: BanRow, serverId?: number): boolean => serverId === undefined || r.scope !== 'server' || r.server_id === serverId;

/** the ban of a player that is in force now (a ban that has run out is removed here); with a server: only a ban that holds there */
export function activeBan(platformId: string, now: number, serverId?: number): BanRow | undefined {
  const r = db.prepare('SELECT * FROM game_bans WHERE platform_id = ?').get(platformId) as BanRow | undefined;
  if (!r) return undefined;
  if (r.until !== 0 && r.until <= now) {
    db.prepare('DELETE FROM game_bans WHERE platform_id = ?').run(platformId);
    return undefined;
  }
  return holdsOn(r, serverId) ? r : undefined;
}

export function listBans(now: number): BanRow[] {
  db.prepare('DELETE FROM game_bans WHERE until <> 0 AND until <= ?').run(now);
  return db.prepare('SELECT * FROM game_bans ORDER BY created_at DESC').all() as BanRow[];
}

export function removeBan(platformId: string): BanRow | undefined {
  const r = db.prepare('SELECT * FROM game_bans WHERE platform_id = ?').get(platformId) as BanRow | undefined;
  if (r) db.prepare('DELETE FROM game_bans WHERE platform_id = ?').run(platformId);
  return r;
}

/** a banned player by the nickname (the nickname that he had when he was banned) */
export function findBanByNick(nick: string): BanRow | undefined {
  const n = nick.trim().toLowerCase();
  if (!n) return undefined;
  return (db.prepare('SELECT * FROM game_bans WHERE ulower(nick) = ?').get(n) as BanRow | undefined)
    ?? (db.prepare('SELECT * FROM game_bans WHERE ulower(nick) LIKE ? LIMIT 1').get(`${n}%`) as BanRow | undefined);
}

// ---- the time of a ban
export const MIN_BAN_SEC = 60;
export const MAX_BAN_SEC = 365 * 86_400;
const UNIT: Array<[RegExp, number]> = [
  [/^(?:m|min|mins|minute|minutes|м|мин|минута|минуты|минут|минуту)$/u, 60],
  [/^(?:h|hr|hrs|hour|hours|ч|час|часа|часов)$/u, 3600],
  [/^(?:d|day|days|д|дн|день|дня|дней)$/u, 86_400],
  [/^(?:w|week|weeks|н|нед|неделя|недели|недель|неделю)$/u, 7 * 86_400],
];

export type BanTime = { seconds: number } | { forever: true } | { error: 'format' | 'short' | 'long' };

/** «30m», «2h», «7d», «2w», «1d12h», «перм» / «навсегда» / «perm» (for ever); a bare number is hours */
export function parseBanTime(input: string): BanTime {
  const s = input.trim().toLowerCase().replace(/,/g, '.');
  if (!s) return { error: 'format' };
  if (/^(?:perm|permanent|forever|навсегда|перм|вечно|навечно)$/u.test(s)) return { forever: true };
  let total = 0;
  let rest = s;
  while (rest.length) {
    const m = /^(\d+(?:\.\d+)?)\s*([a-zа-яё]*)\s*/u.exec(rest);
    if (!m) return { error: 'format' };
    const unit = m[2] === '' ? 3600 : UNIT.find(([re]) => re.test(m[2]))?.[1];
    if (unit === undefined) return { error: 'format' };
    total += Number(m[1]) * unit;
    rest = rest.slice(m[0].length);
  }
  const seconds = Math.round(total);
  if (seconds < MIN_BAN_SEC) return { error: 'short' };
  if (seconds > MAX_BAN_SEC) return { error: 'long' };
  return { seconds };
}

const plural = (n: number, one: string, few: string, many: string): string => {
  const m100 = n % 100;
  const m10 = n % 10;
  if (m100 >= 11 && m100 <= 14) return `${n} ${many}`;
  if (m10 === 1) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
};

/** «7 дней», «1 день 12 часов», «30 минут»: the length of a ban or what is left of it */
export function formatSpan(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 86_400) return formatLeft(s);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  return h ? `${plural(d, 'день', 'дня', 'дней')} ${plural(h, 'час', 'часа', 'часов')}` : plural(d, 'день', 'дня', 'дней');
}

// ---- the commands that the panel gives to the plugin (a kick from Discord)
export interface CommandRow {
  id: number;
  server_id: number;
  type: string;
  payload: string;
  created_at: number;
  state: string;
  result: string;
}

export function queueCommand(serverId: number, type: string, payload: Record<string, unknown>, now: number): number {
  const info = db.prepare("INSERT INTO game_commands (server_id, type, payload, created_at, state, result) VALUES (?, ?, ?, ?, 'pending', '')").run(serverId, type, JSON.stringify(payload), now);
  db.prepare('DELETE FROM game_commands WHERE id NOT IN (SELECT id FROM game_commands ORDER BY id DESC LIMIT 200)').run();
  return Number(info.lastInsertRowid);
}

/** the commands of a server that the plugin has not taken yet (they are marked as taken); those older than a minute are dropped as failed */
export function takeCommands(serverId: number, now: number): { id: number; type: string; payload: Record<string, unknown> }[] {
  db.prepare("UPDATE game_commands SET state = 'failed', result = 'Плагин не забрал команду за минуту' WHERE server_id = ? AND state = 'pending' AND created_at < ?").run(serverId, now - 60_000);
  const rows = db.prepare("SELECT * FROM game_commands WHERE server_id = ? AND state = 'pending' ORDER BY id LIMIT 5").all(serverId) as CommandRow[];
  for (const r of rows) db.prepare("UPDATE game_commands SET state = 'sent' WHERE id = ?").run(r.id);
  return rows.map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payload) as Record<string, unknown> }));
}

export function finishCommand(serverId: number, id: number, ok: boolean, result: string): void {
  db.prepare("UPDATE game_commands SET state = ?, result = ? WHERE id = ? AND server_id = ?").run(ok ? 'done' : 'failed', result.slice(0, 300), id, serverId);
}

export const commandState = (id: number): CommandRow | undefined => db.prepare('SELECT * FROM game_commands WHERE id = ?').get(id) as CommandRow | undefined;
