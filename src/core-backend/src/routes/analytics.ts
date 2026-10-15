/**
 * Player analytics of one server, from what the poller already stores: the poll history (30 days) and the visits of
 * players (player_sessions, 90 days). Days, hours and weekdays are those of the panel's time zone.
 *
 * GET /api/servers/:id/analytics?days=7|30|90
 *   heatmap   average players per weekday x hour (Monday first), the busiest and the quietest hour
 *   summary   unique players (24 h / 7 d / 30 d), new players, visits, average and median visit, player-hours
 *   daily     per day: unique players, new ones, player-hours, peak
 *   sessions  visit lengths in six buckets
 *   cohorts   weekly retention: of the players first seen in a week, the share that came back in the weeks after
 *   top       the ten players with the most time on the server in the period
 */
import express from 'express';
import { viewer } from '../auth.js';
import { db, getSetting } from '../db.js';
import { vrRankIdFor } from '../profile.js';

export const router = express.Router();

const DAY = 86_400_000;
const WEEK = 7 * DAY;
export const SESSION_BUCKETS = [
  { key: 'lt15', label: 'до 15 мин', max: 15 },
  { key: 'lt30', label: '15–30 мин', max: 30 },
  { key: 'lt60', label: '30–60 мин', max: 60 },
  { key: 'lt120', label: '1–2 ч', max: 120 },
  { key: 'lt240', label: '2–4 ч', max: 240 },
  { key: 'more', label: '4 ч и больше', max: Infinity },
] as const;

const timeZone = () => getSetting('timezone') || process.env.TZ || 'Europe/Moscow';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** weekday (0 = Monday), hour and the day key "YYYY-MM-DD" of a moment in the panel's time zone */
export function localParts(ts: number, tz: string): { dow: number; hour: number; day: string } {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
  return { dow: Math.max(0, dow), hour: Number(p.hour) % 24, day: `${p.year}-${p.month}-${p.day}` };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round1 = (v: number) => Math.round(v * 10) / 10;

interface Visit { name: string; key: string; joined: number; left: number }

export function analyticsFor(serverId: number, days: number, now = Date.now()) {
  const tz = timeZone();
  const since = now - days * DAY;

  // ---- weekday x hour: the average of hourly averages (history is kept for 30 days) ----
  const heatSince = now - Math.min(days, 30) * DAY;
  const hourly = db
    .prepare('SELECT ts / 3600000 AS h, AVG(players) AS a, MAX(players) AS m FROM history WHERE server_id = ? AND ts > ? GROUP BY h')
    .all(serverId, heatSince) as { h: number; a: number; m: number }[];
  const sum = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const cnt = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const peak = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of hourly) {
    const { dow, hour } = localParts(r.h * 3600_000, tz);
    sum[dow][hour] += r.a;
    cnt[dow][hour] += 1;
    peak[dow][hour] = Math.max(peak[dow][hour], r.m);
  }
  const cells = sum.map((row, d) => row.map((v, h) => (cnt[d][h] ? round1(v / cnt[d][h]) : null)));
  let busiest: { dow: number; hour: number; avg: number } | null = null;
  let quietest: { dow: number; hour: number; avg: number } | null = null;
  cells.forEach((row, dow) => row.forEach((avg, hour) => {
    if (avg == null) return;
    if (!busiest || avg > busiest.avg) busiest = { dow, hour, avg };
    if (!quietest || avg < quietest.avg) quietest = { dow, hour, avg };
  }));
  // the hour of the day with the fewest players on average over the week: the suggested restart time
  const byHour = Array.from({ length: 24 }, (_, h) => {
    const xs = cells.map((row) => row[h]).filter((v): v is number => v != null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  });
  let restartHour: number | null = null;
  byHour.forEach((v, h) => { if (v != null && (restartHour == null || v < (byHour[restartHour] ?? Infinity))) restartHour = h; });

  // ---- visits ----
  const firstSeen = new Map(
    (db.prepare('SELECT ulower(name) AS k, MIN(joined_at) AS t FROM player_sessions WHERE server_id = ? GROUP BY k').all(serverId) as { k: string; t: number }[]).map((r) => [r.k, r.t]),
  );
  // the cohorts look six weeks back whatever the period
  const from = Math.min(since, now - 6 * WEEK);
  const visits: Visit[] = (
    db.prepare('SELECT name, joined_at, COALESCE(left_at, ?) AS left_at FROM player_sessions WHERE server_id = ? AND COALESCE(left_at, ?) > ? ORDER BY joined_at')
      .all(now, serverId, now, from) as { name: string; joined_at: number; left_at: number }[]
  ).map((r) => ({ name: r.name, key: r.name.toLowerCase(), joined: r.joined_at, left: Math.max(r.joined_at, r.left_at) }));
  const inPeriod = visits.filter((v) => v.left > since);

  const uniqueSince = (t: number) => new Set(visits.filter((v) => v.left > t).map((v) => v.key)).size;
  const minutes = inPeriod.map((v) => (Math.min(v.left, now) - Math.max(v.joined, since)) / 60_000).filter((m) => m > 0);
  const newPlayers = new Set(inPeriod.filter((v) => (firstSeen.get(v.key) ?? 0) > since).map((v) => v.key));
  const players = new Set(inPeriod.map((v) => v.key));

  // ---- per day ----
  const dayKeys: string[] = [];
  for (let t = now - (days - 1) * DAY; t <= now; t += DAY) dayKeys.push(localParts(t, tz).day);
  const dayIdx = new Map(dayKeys.map((d, i) => [d, i]));
  const daily = dayKeys.map((day) => ({ day, players: new Set<string>(), fresh: new Set<string>(), hours: 0, peak: 0 }));
  for (const v of inPeriod) {
    const i = dayIdx.get(localParts(Math.max(v.joined, since), tz).day);
    if (i == null) continue;
    daily[i].players.add(v.key);
    const fs = firstSeen.get(v.key);
    if (fs != null && localParts(fs, tz).day === daily[i].day) daily[i].fresh.add(v.key);
    daily[i].hours += (Math.min(v.left, now) - Math.max(v.joined, since)) / 3600_000;
  }
  for (const r of db.prepare('SELECT ts, players FROM history WHERE server_id = ? AND ts > ?').iterate(serverId, since) as Iterable<{ ts: number; players: number }>) {
    const i = dayIdx.get(localParts(r.ts, tz).day);
    if (i != null && r.players > daily[i].peak) daily[i].peak = r.players;
  }

  // ---- visit lengths ----
  const sessions = SESSION_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: 0 }));
  for (const m of minutes) sessions[SESSION_BUCKETS.findIndex((b) => m < b.max)].count++;

  // ---- weekly retention: cohort c = players first seen c weeks ago ----
  const weekOf = (t: number) => Math.floor((now - t) / WEEK);
  const activeWeeks = new Map<string, Set<number>>();
  for (const v of visits) {
    const s = activeWeeks.get(v.key) ?? new Set<number>();
    for (let w = weekOf(v.left); w <= weekOf(v.joined); w++) s.add(w);
    activeWeeks.set(v.key, s);
  }
  const cohorts = [5, 4, 3, 2, 1, 0].map((c) => {
    const members = [...firstSeen].filter(([, t]) => weekOf(t) === c).map(([k]) => k);
    const rates: number[] = [];
    for (let k = 1; k <= c; k++) {
      const back = members.filter((m) => activeWeeks.get(m)?.has(c - k)).length;
      rates.push(members.length ? Math.round((back / members.length) * 100) : 0);
    }
    return { start: now - (c + 1) * WEEK, size: members.length, rates };
  });

  // ---- top players ----
  const per = new Map<string, { name: string; minutes: number; visits: number; last: number }>();
  for (const v of inPeriod) {
    const p = per.get(v.key) ?? { name: v.name, minutes: 0, visits: 0, last: 0 };
    p.minutes += (Math.min(v.left, now) - Math.max(v.joined, since)) / 60_000;
    p.visits++;
    if (v.left >= p.last) { p.last = v.left; p.name = v.name; }
    per.set(v.key, p);
  }
  const game = (db.prepare('SELECT game FROM servers WHERE id = ?').get(serverId) as { game: string } | undefined)?.game;
  const top = [...per.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 10)
    .map((p) => ({ name: p.name, hours: round1(p.minutes / 60), visits: p.visits, lastSeen: p.last >= now - 60_000 ? null : p.last, ...(game === 'vrising' ? { rankId: vrRankIdFor(p.name) } : {}) }));

  return {
    days,
    timeZone: tz,
    heatmap: { days: Math.min(days, 30), cells, peak, busiest, quietest, restartHour },
    summary: {
      players: players.size,
      dau: uniqueSince(now - DAY),
      wau: uniqueSince(now - WEEK),
      mau: uniqueSince(now - 30 * DAY),
      newPlayers: newPlayers.size,
      returning: players.size - newPlayers.size,
      visits: inPeriod.length,
      avgMinutes: minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null,
      medianMinutes: minutes.length ? Math.round(median(minutes)!) : null,
      playerHours: Math.round(minutes.reduce((a, b) => a + b, 0) / 60),
    },
    daily: daily.map((d) => ({ day: d.day, players: d.players.size, newPlayers: d.fresh.size, hours: round1(d.hours), peak: d.peak })),
    sessions,
    cohorts,
    top,
  };
}

// one computation per server and period per minute: the page polls and several people may look at once
const cache = new Map<string, { at: number; v: ReturnType<typeof analyticsFor> }>();

router.get('/api/servers/:id(\\d+)/analytics', viewer, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(id)) return res.status(404).json({ error: 'Сервер не найден' });
  const asked = Number(req.query.days);
  const days = asked === 7 || asked === 90 ? asked : 30;
  const key = `${id}|${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return res.json(hit.v);
  const v = analyticsFor(id, days);
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), v });
  res.json(v);
});
