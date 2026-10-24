/**
 * Onboarding of the in-game nick: is the nick of an account seen on the servers, who looks like it, autocomplete
 * suggestions for the Discord commands and the one-time "we saw you" notice.
 */
import type { Express, Request, RequestHandler } from 'express';
import { db, EFFECTIVE_NAME } from './db.js';
import { enqueueDelivery } from './deliveries.js';
import { dmAvailable } from './subscriptions.js';
import { distinctNames, similarNames, suggestNames } from './nickMatch.js';
import { log } from './logger.js';

db.exec(`
CREATE TABLE IF NOT EXISTS nick_seen (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  server_id INTEGER
);
`);

const DAY = 86400_000;

// ---------- seen state ----------
export interface NickSeen {
  seen: boolean;
  /** ms; now while the player is online */
  lastSeenAt: number | null;
}

/** Sessions of all games whose name equals the nick (case-insensitive). */
export function nickSeenOf(nick: string, now = Date.now()): NickSeen {
  if (!nick) return { seen: false, lastSeenAt: null };
  const r = db
    .prepare('SELECT MAX(CASE WHEN left_at IS NULL THEN ? ELSE MAX(left_at, joined_at) END) AS t FROM player_sessions WHERE ulower(name) = ulower(?)')
    .get(now, nick) as { t: number | null };
  return r.t == null ? { seen: false, lastSeenAt: null } : { seen: true, lastSeenAt: r.t };
}

// ---------- candidate names (cached) ----------
const CACHE_MS = 15_000;
let cache: { at: number; names: string[] } | null = null;
let nickMap = new Map<string, number>();
let mapAt = 0;
const MAP_TTL = 60_000;

/** online names on vrising servers, other online names, then recently seen ones (14 days), distinct */
export function candidateNames(now = Date.now()): string[] {
  if (cache && now - cache.at < CACHE_MS) return cache.names;
  const online = db
    .prepare(
      `SELECT pn.name AS name, CASE WHEN s.game = 'vrising' THEN 0 ELSE 1 END AS g FROM player_now pn
         LEFT JOIN servers s ON s.id = pn.server_id ORDER BY g, pn.since DESC LIMIT 1000`,
    )
    .all() as { name: string }[];
  const recent = db
    .prepare('SELECT name, MAX(joined_at) AS m FROM player_sessions WHERE joined_at >= ? GROUP BY name ORDER BY m DESC LIMIT 2000')
    .all(now - 14 * DAY) as { name: string }[];
  const names = distinctNames([...online, ...recent].map((r) => r.name));
  cache = { at: now, names };
  return names;
}
/** forget the cached candidate list and the nick map (tests, nick changes) */
export const resetNickCaches = (): void => {
  cache = null;
  mapAt = 0;
};

/** lowercased nicks used by accounts other than `exceptUserId` */
function takenByOthers(exceptUserId: number): Set<string> {
  const rows = db.prepare("SELECT game_nick FROM user_player WHERE game_nick != '' AND user_id != ?").all(exceptUserId) as { game_nick: string }[];
  return new Set(rows.map((r) => r.game_nick.toLowerCase()));
}

/** Autocomplete for /register and /nick (the player's own current nick is allowed). Never throws. */
export function nickSuggestions(query: string, discordId: string, limit = 25): string[] {
  try {
    const u = /^\d{15,25}$/.test(discordId)
      ? (db.prepare('SELECT id FROM users WHERE discord_id = ?').get(discordId) as { id: number } | undefined)
      : undefined;
    const taken = takenByOthers(u?.id ?? 0);
    const free = candidateNames().filter((n) => !taken.has(n.toLowerCase()));
    return suggestNames(query.slice(0, 100), free, limit);
  } catch (e) {
    log.error('nick-suggest failed', (e as Error).message);
    return [];
  }
}

// ---------- first seen ----------
/** lower(game_nick) -> user_id for active accounts not marked yet; refreshed every 60 s or after a nick change */
function unmarkedNicks(now: number): Map<string, number> {
  if (mapAt > 0 && now - mapAt < MAP_TTL) return nickMap;
  const rows = db
    .prepare(
      `SELECT up.user_id AS id, up.game_nick AS nick FROM user_player up JOIN users u ON u.id = up.user_id AND u.status = 'active'
       WHERE up.game_nick != '' AND NOT EXISTS (SELECT 1 FROM nick_seen ns WHERE ns.user_id = up.user_id)`,
    )
    .all() as { id: number; nick: string }[];
  nickMap = new Map(rows.map((r) => [r.nick.toLowerCase(), r.id]));
  mapAt = now;
  return nickMap;
}

function markSeen(userId: number, serverId: number, now: number): void {
  const ins = db.prepare('INSERT OR IGNORE INTO nick_seen (user_id, ts, server_id) VALUES (?, ?, ?)').run(userId, now, serverId);
  if (!ins.changes) return;
  for (const [k, id] of nickMap) if (id === userId) nickMap.delete(k);
  const srv = db.prepare(`SELECT ${EFFECTIVE_NAME} AS n FROM servers s LEFT JOIN status st ON st.server_id = s.id WHERE s.id = ?`).get(serverId) as { n: string } | undefined;
  const text = `Мы увидели вас на сервере «${srv?.n ?? 'сервер'}»: статистика, ранг и достижения теперь считаются`;
  db.prepare('INSERT INTO user_notifications (user_id, ts, kind, server_id, text) VALUES (?, ?, ?, ?, ?)').run(userId, now, 'nick_seen', serverId, text);
  db.prepare("INSERT INTO account_events (user_id, ts, kind, ip, ua, detail) VALUES (?, ?, 'nick_seen', '', '', ?)").run(userId, now, (srv?.n ?? '').slice(0, 200));
  const u = db.prepare('SELECT discord_id FROM users WHERE id = ?').get(userId) as { discord_id: string | null } | undefined;
  if (u?.discord_id && dmAvailable()) {
    enqueueDelivery({ kind: 'dm', refId: null, target: u.discord_id, payload: { content: `👣 ${text}`, summary: text.slice(0, 120) } });
  }
}

/** Poller hook: sessions that were just opened. Cheap: one map lookup per name. Never throws. */
export function onSessionsOpened(serverId: number, names: string[], now = Date.now()): void {
  try {
    if (!names.length) return;
    const map = unmarkedNicks(now);
    if (!map.size) return;
    for (const n of names) {
      const id = map.get(n.toLowerCase());
      if (id !== undefined) markSeen(id, serverId, now);
    }
  } catch (e) {
    log.error('nick-seen failed', (e as Error).message);
  }
}

/** A nick was just set: when the player is online right now they are marked at once. Never throws. */
export function checkNickNow(userId: number, nick: string, now = Date.now()): void {
  try {
    resetNickCaches();
    if (!nick || db.prepare('SELECT 1 FROM nick_seen WHERE user_id = ?').get(userId)) return;
    const u = db.prepare("SELECT 1 FROM users WHERE id = ? AND status = 'active'").get(userId);
    if (!u) return;
    const s = db.prepare('SELECT server_id FROM player_sessions WHERE left_at IS NULL AND ulower(name) = ulower(?) LIMIT 1').get(nick) as { server_id: number } | undefined;
    if (s) markSeen(userId, s.server_id, now);
  } catch (e) {
    log.error('nick check failed', (e as Error).message);
  }
}

// ---------- panel ----------
export function nickStatusOf(userId: number): { nick: string; seen: boolean; lastSeenAt: number | null; similar: string[] } {
  const row = db.prepare('SELECT game_nick FROM user_player WHERE user_id = ?').get(userId) as { game_nick: string } | undefined;
  const nick = row?.game_nick ?? '';
  if (!nick) return { nick, seen: false, lastSeenAt: null, similar: [] };
  const s = nickSeenOf(nick);
  if (s.seen) return { nick, seen: true, lastSeenAt: s.lastSeenAt, similar: [] };
  const taken = takenByOthers(userId);
  const similar = similarNames(nick, candidateNames().filter((n) => !taken.has(n.toLowerCase())), 5);
  return { nick, seen: false, lastSeenAt: null, similar };
}

export function registerNickStatus(deps: { app: Express; auth: RequestHandler; userId: (req: Request) => number }): void {
  deps.app.get('/api/me/nick-status', deps.auth, (req, res) => res.json(nickStatusOf(deps.userId(req))));
}
