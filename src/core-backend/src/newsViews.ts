/**
 * Views of a news item: the page counts one view per visitor session (the browser asks once per tab session).
 *   POST /api/news/:id/view   { } → { views }  (published news only, 120 requests a minute per address)
 * The totals sit next to a per-day count (the chart in the statistics of a news item).
 */
import express from 'express';
import { rateLimit, viewer } from './auth.js';
import { db } from './db.js';
import { param } from './http.js';

export const router = express.Router();

db.exec(`
CREATE TABLE IF NOT EXISTS news_views (
  news_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (news_id, day)
);
`);

export const viewsOf = (newsId: number): number => (db.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM news_views WHERE news_id = ?').get(newsId) as { n: number }).n;

/** views per day for the last `days` days, oldest first (days without a view are 0) */
export function viewsByDay(newsId: number, days = 30, now = Date.now()): { day: string; n: number }[] {
  const rows = new Map((db.prepare('SELECT day, n FROM news_views WHERE news_id = ? AND day >= ?').all(newsId, dayKey(now - (days - 1) * 86_400_000)) as { day: string; n: number }[]).map((r) => [r.day, r.n]));
  return Array.from({ length: days }, (_, i) => {
    const day = dayKey(now - (days - 1 - i) * 86_400_000);
    return { day, n: rows.get(day) ?? 0 };
  });
}

export const dayKey = (ts: number): string => new Date(ts).toISOString().slice(0, 10);

router.post('/api/news/:id/view', param('id'), rateLimit(120), viewer, (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('SELECT status FROM news WHERE id = ? AND test = 0').get(id) as { status: string } | undefined;
  if (!r || (r.status !== 'sent' && r.status !== 'edit_queued')) return res.status(404).json({ error: 'Новость не найдена' });
  db.prepare('INSERT INTO news_views (news_id, day, n) VALUES (?, ?, 1) ON CONFLICT(news_id, day) DO UPDATE SET n = n + 1').run(id, dayKey(Date.now()));
  res.json({ views: viewsOf(id) });
});
