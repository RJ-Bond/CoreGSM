/**
 * The community as a whole, for the main page and the public «Сообщество» page, and the card of one player.
 *
 * GET /api/community
 *   now       players online on all servers, servers online
 *   record    the most players online at once in the last 30 days (5-minute buckets) and when
 *   heatmap   average players on all servers per weekday x hour (panel time zone), the busiest hour
 *   players   unique players in the last 24 h / 7 days / 30 days, new players this week
 *   feed      the latest arrivals: who came to which server, newcomers marked
 *   series    players on all servers over the last 24 h, in 30-minute steps
 *   top       the players with the most hours today, this week, this month and in all the kept history (up to 25 each);
 *             `online` = on a server now, `prev` = the place in the period before (null: not in its top 50)
 *   servers   the servers by players now
 *
 * GET /api/players/:name   one player by the nick the game servers report: where and when they play
 */
import express from 'express';
import { viewer } from '../auth.js';
import { db, EFFECTIVE_NAME, getSetting } from '../db.js';
import { localParts } from '../localTime.js';
import { playAchievements, vrRankIdFor } from '../profile.js';
import { seasonAchievements } from '../seasons.js';

export const router = express.Router();

const DAY = 86_400_000;
const tz = () => getSetting('timezone') || process.env.TZ || 'Europe/Moscow';

interface ServerName { id: number; name: string; game: string }
const serverNames = () =>
  new Map((db.prepare(`SELECT s.id, ${EFFECTIVE_NAME} AS name, s.game FROM servers s LEFT JOIN status st ON st.server_id = s.id`).all() as ServerName[]).map((s) => [s.id, s]));

/** the players with the most hours since `since` (any case of a nick counts as one player) */
export function topPlayers(since: number, now = Date.now(), limit = 10, serverId?: number): { name: string; hours: number; servers: number }[] {
  return (db
    .prepare(
      `SELECT MIN(name) AS name, ulower(name) AS k, SUM(MIN(COALESCE(left_at, ?), ?) - MAX(joined_at, ?)) / 3600000.0 AS h, COUNT(DISTINCT server_id) AS servers
       FROM player_sessions WHERE COALESCE(left_at, ?) > ? AND joined_at < ? ${serverId ? 'AND server_id = ?' : ''} GROUP BY k ORDER BY h DESC LIMIT ?`,
    )
    .all(now, now, since, now, since, now, ...(serverId ? [serverId] : []), limit) as { name: string; h: number; servers: number }[]).map((r) => ({ name: r.name, hours: Math.round(r.h * 10) / 10, servers: r.servers }));
}

function community(now = Date.now()) {
  const names = serverNames();
  const live = db.prepare('SELECT s.id, st.online, st.players, st.max_players FROM servers s LEFT JOIN status st ON st.server_id = s.id').all() as { id: number; online: number | null; players: number | null; max_players: number | null }[];

  // the most players at once: per 5-minute bucket the busiest moment of each server, summed
  const buckets = new Map<number, number>();
  for (const r of db
    .prepare('SELECT ts / 300000 AS b, server_id, MAX(players) AS p FROM history WHERE ts > ? AND online = 1 GROUP BY b, server_id')
    .iterate(now - 30 * DAY) as Iterable<{ b: number; p: number }>) buckets.set(r.b, (buckets.get(r.b) ?? 0) + r.p);
  let record: { players: number; at: number } | null = null;
  for (const [b, p] of buckets) if (!record || p > record.players) record = { players: p, at: b * 300_000 };

  // weekday x hour of the whole community: the hourly totals averaged
  const hourly = new Map<number, number>();
  for (const r of db
    .prepare('SELECT ts / 3600000 AS h, server_id, AVG(players) AS a FROM history WHERE ts > ? GROUP BY h, server_id')
    .iterate(now - 30 * DAY) as Iterable<{ h: number; a: number }>) hourly.set(r.h, (hourly.get(r.h) ?? 0) + r.a);
  const sum = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const cnt = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const zone = tz();
  for (const [h, total] of hourly) {
    const p = localParts(h * 3600_000, zone);
    sum[p.dow][p.hour] += total;
    cnt[p.dow][p.hour]++;
  }
  const cells = sum.map((row, d) => row.map((v, h) => (cnt[d][h] ? Math.round((v / cnt[d][h]) * 10) / 10 : null)));
  let busiest: { dow: number; hour: number; avg: number } | null = null;
  cells.forEach((row, dow) => row.forEach((avg, hour) => { if (avg != null && (!busiest || avg > busiest.avg)) busiest = { dow, hour, avg }; }));

  const uniq = (since: number, until = now) => (db.prepare('SELECT COUNT(DISTINCT ulower(name)) AS n FROM player_sessions WHERE COALESCE(left_at, ?) > ? AND joined_at < ?').get(now, since, until) as { n: number }).n;
  const firstSeen = db.prepare('SELECT MIN(joined_at) AS t FROM player_sessions WHERE ulower(name) = ulower(?)');
  const newBetween = (from: number, to: number) => (db.prepare('SELECT COUNT(*) AS n FROM (SELECT ulower(name) AS k, MIN(joined_at) AS t FROM player_sessions GROUP BY k) WHERE t > ? AND t <= ?').get(from, to) as { n: number }).n;
  const newWeek = newBetween(now - 7 * DAY, now);

  const feed = (db.prepare('SELECT server_id, name, joined_at, left_at FROM player_sessions ORDER BY joined_at DESC LIMIT 14').all() as { server_id: number; name: string; joined_at: number; left_at: number | null }[])
    .filter((r) => names.has(r.server_id))
    .map((r) => ({
      name: r.name,
      serverId: r.server_id,
      serverName: names.get(r.server_id)!.name,
      game: names.get(r.server_id)!.game,
      at: r.joined_at,
      online: r.left_at == null,
      newcomer: (firstSeen.get(r.name) as { t: number }).t === r.joined_at,
    }));

  // the same players' places in the period before, and who is on a server right now
  const live_ = new Set((db.prepare('SELECT DISTINCT ulower(name) AS k FROM player_sessions WHERE left_at IS NULL').all() as { k: string }[]).map((r) => r.k));
  const topSince = (span: number | null) => {
    const list = topPlayers(span == null ? 0 : now - span, now, 25);
    const before = span == null ? [] : topPlayers(now - 2 * span, now - span, 50);
    const place = new Map(before.map((p, i) => [p.name.toLowerCase(), i + 1]));
    return list.map((p) => ({ ...p, online: live_.has(p.name.toLowerCase()), prev: place.get(p.name.toLowerCase()) ?? null }));
  };

  // players on all servers over the last 24 h: per 30-minute step the servers' averages summed
  const stepMs = 1_800_000;
  const stepTotals = new Map<number, number>();
  for (const r of db
    .prepare('SELECT ts / ? AS b, server_id, AVG(players) AS a FROM history WHERE ts > ? AND online = 1 GROUP BY b, server_id')
    .iterate(stepMs, now - DAY) as Iterable<{ b: number; a: number }>) stepTotals.set(r.b, (stepTotals.get(r.b) ?? 0) + r.a);
  const series = [...stepTotals].sort((x, y) => x[0] - y[0]).map(([b, v]) => ({ ts: b * stepMs, players: Math.round(v * 10) / 10 }));

  const servers = live
    .filter((s) => names.has(s.id))
    .map((s) => ({ id: s.id, name: names.get(s.id)!.name, game: names.get(s.id)!.game, online: !!s.online, players: s.online ? s.players ?? 0 : 0, maxPlayers: s.max_players ?? 0 }))
    .sort((a, b) => b.players - a.players);

  return {
    now: { players: servers.reduce((n, s) => n + s.players, 0), online: servers.filter((s) => s.online).length, servers: servers.length },
    record,
    heatmap: { cells, busiest },
    players: {
      day: uniq(now - DAY), week: uniq(now - 7 * DAY), month: uniq(now - 30 * DAY), newWeek,
      prev: { day: uniq(now - 2 * DAY, now - DAY), week: uniq(now - 14 * DAY, now - 7 * DAY), month: uniq(now - 60 * DAY, now - 30 * DAY), newWeek: newBetween(now - 14 * DAY, now - 7 * DAY) },
    },
    feed,
    series,
    top: { day: topSince(DAY), week: topSince(7 * DAY), month: topSince(30 * DAY), all: topSince(null) },
    servers,
  };
}

let cached: { at: number; v: ReturnType<typeof community> } | null = null;
router.get('/api/community', viewer, (_req, res) => {
  if (!cached || Date.now() - cached.at > 30_000) cached = { at: Date.now(), v: community() };
  res.json(cached.v);
});

/** one player: the visits of a nick (any case) on every server in the 90 days the panel keeps */
export function playerCard(nick: string, now = Date.now()) {
  const visits = db
    .prepare('SELECT server_id, name, joined_at, COALESCE(left_at, ?) AS left_at, left_at IS NULL AS live FROM player_sessions WHERE ulower(name) = ulower(?) ORDER BY joined_at')
    .all(now, nick) as { server_id: number; name: string; joined_at: number; left_at: number; live: number }[];
  if (!visits.length) return null;
  const names = serverNames();
  const zone = tz();
  const hours = (v: { joined_at: number; left_at: number }) => (v.left_at - v.joined_at) / 3600_000;
  const per = new Map<number, { hours: number; visits: number; last: number }>();
  const byHour = Array<number>(24).fill(0);
  const days = new Set<string>();
  for (const v of visits) {
    const p = per.get(v.server_id) ?? { hours: 0, visits: 0, last: 0 };
    p.hours += hours(v);
    p.visits++;
    p.last = Math.max(p.last, v.left_at);
    per.set(v.server_id, p);
    // the hours of the day the player is on, counted in quarter-hour steps
    for (let t = v.joined_at; t < v.left_at; t += 900_000) byHour[localParts(t, zone).hour] += 0.25;
    days.add(localParts(v.joined_at, zone).day);
  }
  // the streak: days in a row with a visit, up to today (or yesterday)
  let streak = 0;
  for (let k = 0; k < 90; k++) {
    const d = localParts(now - k * DAY, zone).day;
    if (days.has(d)) streak++;
    else if (k > 0) break;
  }
  const name = visits[visits.length - 1].name;
  const game = [...per.keys()].map((id) => names.get(id)?.game).find((g) => g === 'vrising');
  const total = visits.reduce((n, v) => n + hours(v), 0);
  return {
    name,
    firstSeen: visits[0].joined_at,
    lastSeen: visits.some((v) => v.live) ? null : visits[visits.length - 1].left_at,
    online: visits.some((v) => v.live),
    hours: Math.round(total * 10) / 10,
    visits: visits.length,
    days: days.size,
    streak,
    usualHour: byHour.some((v) => v > 0) ? byHour.indexOf(Math.max(...byHour)) : null,
    byHour: byHour.map((v) => Math.round(v * 10) / 10),
    servers: [...per]
      .filter(([id]) => names.has(id))
      .map(([id, p]) => ({ id, name: names.get(id)!.name, game: names.get(id)!.game, hours: Math.round(p.hours * 10) / 10, visits: p.visits, last: p.last }))
      .sort((a, b) => b.hours - a.hours),
    recent: visits.slice(-8).reverse().filter((v) => names.has(v.server_id)).map((v) => ({ serverId: v.server_id, serverName: names.get(v.server_id)!.name, from: v.joined_at, to: v.live ? null : v.left_at })),
    achievements: [...playAchievements(visits.map((v) => ({ server_id: v.server_id, joined_at: v.joined_at, left_at: v.live ? null : v.left_at })), zone, now), ...seasonAchievements(name, now)],
    ...(game ? { rankId: vrRankIdFor(name) } : {}),
  };
}

router.get('/api/players/:name', viewer, (req, res) => {
  const nick = String(req.params.name).slice(0, 64);
  const card = playerCard(nick);
  if (!card) return res.status(404).json({ error: 'Игрок не найден' });
  res.json(card);
});
