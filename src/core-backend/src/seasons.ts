/**
 * Seasons (usually one per wipe): the admin starts a new season, the previous one ends at that moment.
 *   GET    /api/seasons          the current season with its leaderboard, the finished ones with their podium
 *                               (the «Зал славы»)
 *   POST   /api/seasons          start a new season (admin)
 *   PUT    /api/seasons/:id      rename (admin)
 *   DELETE /api/seasons/:id      remove (admin); the season before it stays as it was
 *
 * seasonAchievements(nick) adds the season badges to a player's card: the first visitor of a new season, a place
 * on the podium of a finished season and its champion.
 */
import express from 'express';
import { z } from 'zod';
import { admin, viewer } from './auth.js';
import { db } from './db.js';
import { mk, type Achievement } from './profile.js';
import { topPlayers } from './routes/community.js';
import { param } from './http.js';

export const router = express.Router();

db.exec(`
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_seasons_start ON seasons(starts_at);
`);

interface SeasonRow { id: number; name: string; starts_at: number; ends_at: number | null }

const all = () => db.prepare('SELECT * FROM seasons ORDER BY starts_at').all() as SeasonRow[];

/** the end of a season: its own end, else the start of the next one, else now (the current season) */
function endOf(s: SeasonRow, list: SeasonRow[], now: number): number {
  if (s.ends_at) return s.ends_at;
  const next = list.find((x) => x.starts_at > s.starts_at);
  return next ? next.starts_at : now;
}

/** the first visitor after the start of a season (null when nobody came) */
function firstOf(s: SeasonRow, end: number): { name: string; at: number } | null {
  const r = db.prepare('SELECT name, joined_at FROM player_sessions WHERE joined_at >= ? AND joined_at < ? ORDER BY joined_at LIMIT 1').get(s.starts_at, end) as { name: string; joined_at: number } | undefined;
  return r ? { name: r.name, at: r.joined_at } : null;
}

export function seasonsView(now = Date.now()) {
  const list = all();
  const current = [...list].reverse().find((s) => !s.ends_at && s.starts_at <= now) ?? null;
  const finished = list.filter((s) => s !== current && s.starts_at <= now).reverse();
  return {
    current: current
      ? { id: current.id, name: current.name, startsAt: current.starts_at, top: topPlayers(current.starts_at, now, 10), first: firstOf(current, now) }
      : null,
    past: finished.map((s) => {
      const end = endOf(s, list, now);
      return { id: s.id, name: s.name, startsAt: s.starts_at, endsAt: end, podium: topPlayers(s.starts_at, end, 3), first: firstOf(s, end) };
    }),
  };
}

/** the season badges of a nick */
export function seasonAchievements(nick: string, now = Date.now()): Achievement[] {
  const key = nick.toLowerCase();
  const list = all().filter((s) => s.starts_at <= now);
  let firstAt: number | null = null;
  let podiumAt: number | null = null;
  let champAt: number | null = null;
  let podiums = 0;
  let titles = 0;
  for (const s of list) {
    const end = endOf(s, list, now);
    const first = firstOf(s, end);
    if (first && first.name.toLowerCase() === key) firstAt ??= first.at;
    // a podium counts only when the season is over
    if (end >= now) continue;
    const podium = topPlayers(s.starts_at, end, 3).map((p) => p.name.toLowerCase());
    const place = podium.indexOf(key);
    if (place >= 0) { podiums++; podiumAt ??= end; }
    if (place === 0) { titles++; champAt ??= end; }
  }
  return [
    mk('season-first', 'Первопроходец', 'Зайдите первым после старта нового сезона', 'star', firstAt ? 1 : 0, 1, firstAt),
    mk('season-podium', 'Призёр сезона', 'Войдите в тройку самых активных игроков сезона', 'crown', Math.min(podiums, 1), 1, podiumAt),
    mk('season-champion', 'Чемпион сезона', 'Наиграйте больше всех часов за сезон', 'crown', Math.min(titles, 1), 1, champAt),
  ];
}

router.get('/api/seasons', viewer, (_req, res) => res.json(seasonsView()));

const nameSchema = z.string().trim().min(1).max(60);

/** a new season starts at `at`; the open one ends there */
export function startSeason(name: string, at: number): number {
  return db.transaction(() => {
    db.prepare('UPDATE seasons SET ends_at = ? WHERE ends_at IS NULL AND starts_at < ?').run(at, at);
    return Number(db.prepare('INSERT INTO seasons (name, starts_at) VALUES (?, ?)').run(name, at).lastInsertRowid);
  })();
}

router.post('/api/seasons', admin, (req, res) => {
  const b = z.object({ name: nameSchema, startsAt: z.number().int().positive().optional() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  const at = Math.min(b.data.startsAt ?? Date.now(), Date.now() + 365 * 86_400_000);
  const id = startSeason(b.data.name, at);
  res.json({ id, ...seasonsView() });
});

router.put('/api/seasons/:id', param('id'), admin, (req, res) => {
  const b = z.object({ name: nameSchema }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  const r = db.prepare('UPDATE seasons SET name = ? WHERE id = ?').run(b.data.name, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Не найдено' });
  res.json(seasonsView());
});

router.delete('/api/seasons/:id', param('id'), admin, (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare('SELECT * FROM seasons WHERE id = ?').get(id) as SeasonRow | undefined;
  if (!s) return res.status(404).json({ error: 'Не найдено' });
  db.transaction(() => {
    db.prepare('DELETE FROM seasons WHERE id = ?').run(id);
    // removing the current season reopens the one before it
    if (!s.ends_at) db.prepare('UPDATE seasons SET ends_at = NULL WHERE id = (SELECT id FROM seasons WHERE starts_at < ? ORDER BY starts_at DESC LIMIT 1) AND ends_at = ?').run(s.starts_at, s.starts_at);
  })();
  res.json(seasonsView());
});
