/**
 * Subscriptions to the rubrics of the news: a signed-in user picks the rubrics he wants to hear about; when an item
 * of such a rubric is published for the first time, the notification goes to the bell of the panel (with a link to
 * the item), to the devices with Web Push and, when the account is linked, to Discord as a DM — the same three ways
 * as the server subscriptions and the player follows.
 *
 *   GET /api/me/news-subscriptions   { categories: [...] }
 *   PUT /api/me/news-subscriptions   { categories: [...] } (replaces the list; an empty list unsubscribes)
 *
 * news.ts calls notifyNewsPublished() once, when the bot has posted an item for the first time.
 * Statistics of one item for the editors:
 *   GET /api/news/:id/stats          views by day, reactions, comments (permission «Новости»)
 */
import express from 'express';
import { z } from 'zod';
import { allow, auth, type AuthedRequest } from './auth.js';
import { db } from './db.js';
import { enqueueDelivery } from './deliveries.js';
import { param } from './http.js';
import { log } from './logger.js';
import { viewsByDay, viewsOf } from './newsViews.js';
import { dmAvailable, pushToUser } from './subscriptions.js';

export const router = express.Router();

export const NEWS_RUBRICS = ['announcement', 'wipe', 'update', 'event', 'maintenance', 'other'] as const;
export type Rubric = (typeof NEWS_RUBRICS)[number];

db.exec(`
CREATE TABLE IF NOT EXISTS news_subscriptions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY (user_id, category)
);
CREATE INDEX IF NOT EXISTS idx_news_subs_cat ON news_subscriptions(category);
`);

export const RUBRIC_EMOJI: Record<Rubric, string> = { announcement: '📣', wipe: '🧹', update: '🛠️', event: '🎉', maintenance: '🔧', other: '📰' };

/** «🧹 Новая новость: …» for the bell and the DM */
export const newsNoticeText = (category: string, title: string): string => `${RUBRIC_EMOJI[category as Rubric] ?? '📰'} Новая новость: «${title.slice(0, 120)}»`;

export const normRubric = (c: unknown): Rubric => ((NEWS_RUBRICS as readonly string[]).includes(String(c)) ? (c as Rubric) : 'announcement');

/** Tells the subscribers of the rubric about a published item (never throws into the news flow). Returns how many were told. */
export function notifyNewsPublished(item: { id: number; title: string; category: string; authorId: number | null }, base = ''): number {
  try {
    const category = normRubric(item.category);
    const subs = db
      .prepare(`SELECT s.user_id, u.discord_id FROM news_subscriptions s JOIN users u ON u.id = s.user_id AND u.status = 'active' WHERE s.category = ? AND s.user_id IS NOT ?`)
      .all(category, item.authorId) as { user_id: number; discord_id: string | null }[];
    if (!subs.length) return 0;
    const now = Date.now();
    const text = newsNoticeText(category, item.title);
    const url = `/news/${item.id}`;
    const insert = db.prepare('INSERT INTO user_notifications (user_id, ts, kind, server_id, text, url) VALUES (?, ?, ?, NULL, ?, ?)');
    for (const s of subs) {
      insert.run(s.user_id, now, 'news', text, url);
      if (s.discord_id && dmAvailable()) {
        const content = base ? `${text}\n${base}${url}` : text;
        enqueueDelivery({ kind: 'dm', refId: null, target: s.discord_id, payload: { content, summary: text.slice(0, 120) } });
      }
      pushToUser(s.user_id, { title: 'Новости', body: text, url, tag: `news-${item.id}` });
    }
    return subs.length;
  } catch (e) {
    log.error('news subscriptions failed', (e as Error).message);
    return 0;
  }
}

router.get('/api/me/news-subscriptions', auth, (req: AuthedRequest, res) => {
  const rows = db.prepare('SELECT category FROM news_subscriptions WHERE user_id = ?').all(req.user!.id) as { category: string }[];
  res.json({ categories: NEWS_RUBRICS.filter((c) => rows.some((r) => r.category === c)) });
});

router.put('/api/me/news-subscriptions', auth, (req: AuthedRequest, res) => {
  const b = z.object({ categories: z.array(z.enum(NEWS_RUBRICS)).max(NEWS_RUBRICS.length) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  const uid = req.user!.id;
  const list = [...new Set(b.data.categories)];
  db.transaction(() => {
    db.prepare('DELETE FROM news_subscriptions WHERE user_id = ?').run(uid);
    const ins = db.prepare('INSERT INTO news_subscriptions (user_id, category) VALUES (?, ?)');
    for (const c of list) ins.run(uid, c);
  })();
  res.json({ categories: NEWS_RUBRICS.filter((c) => list.includes(c)) });
});

router.get('/api/news/:id/stats', param('id'), allow('news'), (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('SELECT sent_at FROM news WHERE id = ? AND test = 0').get(id) as { sent_at: number | null } | undefined;
  if (!r) return res.status(404).json({ error: 'Новость не найдена' });
  const reactions = db.prepare('SELECT emoji, COUNT(*) AS count FROM news_reactions WHERE news_id = ? GROUP BY emoji ORDER BY count DESC').all(id) as { emoji: string; count: number }[];
  const comments = (db.prepare("SELECT COUNT(*) AS n FROM news_comments WHERE news_id = ? AND status = 'visible'").get(id) as { n: number }).n;
  res.json({ sentAt: r.sent_at, views: viewsOf(id), byDay: viewsByDay(id, 30), reactions, comments });
});
