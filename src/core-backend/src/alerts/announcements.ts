/**
 * Scheduled announcements: a text sent to a Discord channel at a set time, once or every day / week.
 *
 *   GET    /api/announcements        (admin) the plan
 *   POST   /api/announcements        (admin) { title?, text, channelId, mention?, at, repeat? }
 *   DELETE /api/announcements/:id    (admin)
 *
 * A timer looks every 30 seconds for the ones that are due and puts them in the same queue as the other messages
 * of the panel (retries, quiet hours and the common look come with it).
 */
import type { Express, RequestHandler } from 'express';
import { COLORS } from '../discord/palette.js';
import { db } from '../db.js';
import { log } from '../logger.js';
import { param } from '../http.js';
import { enqueueAlert } from './alerts.js';
import { MAX_ACTIVE, nextRun, validateAnnouncement, type Repeat } from './announcementLogic.js';

db.exec(`
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  mention TEXT NOT NULL DEFAULT 'none',
  repeat TEXT NOT NULL DEFAULT 'none',
  next_at INTEGER,
  last_sent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_next ON announcements(next_at);
`);

interface Row { id: number; title: string; text: string; channel_id: string; mention: 'none' | 'here' | 'everyone'; repeat: Repeat; next_at: number | null; last_sent_at: number | null; created_at: number }

/** sends what is due; returns how many */
export function runDueAnnouncements(now = Date.now()): number {
  const due = db.prepare('SELECT * FROM announcements WHERE next_at IS NOT NULL AND next_at <= ? ORDER BY next_at').all(now) as Row[];
  for (const a of due) {
    try {
      enqueueAlert('digest', a.title || 'announcement', {
        content: a.mention === 'none' ? '' : `@${a.mention}`,
        mention: a.mention,
        embed: { ...(a.title ? { title: a.title } : {}), description: a.text, color: COLORS.info },
      }, a.channel_id);
    } catch (e) {
      log.warn('announcement not queued', (e as Error).message);
    }
    db.prepare('UPDATE announcements SET last_sent_at = ?, next_at = ? WHERE id = ?').run(now, nextRun(a.next_at!, a.repeat, now), a.id);
  }
  return due.length;
}

export function registerAnnouncements({ app, admin }: { app: Express; admin: RequestHandler }): void {
  const view = (r: Row) => ({ id: r.id, title: r.title, text: r.text, channelId: r.channel_id, mention: r.mention, repeat: r.repeat, nextAt: r.next_at, lastSentAt: r.last_sent_at });

  app.get('/api/announcements', admin, (_req, res) => {
    res.json((db.prepare('SELECT * FROM announcements ORDER BY COALESCE(next_at, 9e15), id DESC').all() as Row[]).map(view));
  });

  app.post('/api/announcements', admin, (req, res) => {
    const v = validateAnnouncement(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const active = (db.prepare('SELECT COUNT(*) AS n FROM announcements WHERE next_at IS NOT NULL').get() as { n: number }).n;
    if (active >= MAX_ACTIVE) return res.status(400).json({ error: `Не больше ${MAX_ACTIVE} запланированных объявлений` });
    const i = v.value;
    const id = Number(db.prepare('INSERT INTO announcements (title, text, channel_id, mention, repeat, next_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(i.title, i.text, i.channelId, i.mention, i.repeat, i.at, Date.now()).lastInsertRowid);
    res.json(view(db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as Row));
  });

  app.delete('/api/announcements/:id', param('id'), admin, (req, res) => {
    const r = db.prepare('DELETE FROM announcements WHERE id = ?').run(Number(req.params.id));
    if (!r.changes) return res.status(404).json({ error: 'Не найдено' });
    res.json({ ok: true });
  });

  setInterval(() => { try { runDueAnnouncements(); } catch (e) { log.warn('announcements tick failed', (e as Error).message); } }, 30_000).unref();
}
