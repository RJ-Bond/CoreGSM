/**
 * Comments under a news item (the site and the panel).
 *
 *   GET    /api/news/:id/comments            the thread: comments, replies, reactions, what the viewer may do
 *   POST   /api/news/:id/comments            write { text, parentId? } (signed in)
 *   PATCH  /api/news/comments/:cid           edit your own comment within 10 minutes { text }
 *   DELETE /api/news/comments/:cid           delete your own comment (staff: hide, see below)
 *   PUT    /api/news/comments/:cid/reaction  { emoji | null }
 *   POST   /api/news/comments/:cid/flag      complain about a comment (once per user)
 *   GET    /api/news/comments/mentions?q=    nicks for the @-hint
 *   GET    /api/news/discussed               the news with the most comments lately (the side panel)
 * Moderation (permission «Модерация»):
 *   POST   /api/news/comments/:cid/hide      hide with a reason { reason } / { restore: true } shows it again
 *   POST   /api/news/comments/:cid/pin       pin to the top of the thread { pinned } (one per news)
 *   GET    /api/news/comments/queue          complained-about and hidden comments
 *   GET    /api/news/comments/count          how many wait in the queue (the badge of the admin menu)
 *   POST   /api/news/comments/bulk           { ids, action: 'approve' | 'hide' | 'delete' }
 * Staff with the «Новости» permission:
 *   PUT    /api/news/:id/comments/lock       close / open the thread of one news item { locked }
 *   GET|PUT /api/news/comments/settings      the switch for the whole site { enabled }
 */
import express from 'express';
import { z } from 'zod';
import { allow, auth, viewer, type AuthedRequest } from './auth.js';
import { db, getSetting, setSetting } from './db.js';
import { param } from './http.js';
import { pushToUser } from './subscriptions.js';

export const router = express.Router();
const moderator = allow('moderation');
const newsStaff = allow('news');

export const MAX_LEN = 1000;
export const EDIT_WINDOW_MS = 10 * 60_000;
export const EMOJI = ['👍', '❤️', '😂', '🔥'] as const;
const BURST = 8;
const BURST_MS = 10 * 60_000;
const MAX_THREAD = 500;

db.exec(`
CREATE TABLE IF NOT EXISTS news_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  news_id INTEGER NOT NULL,
  parent_id INTEGER,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',
  hide_reason TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  edited_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ncomments_news ON news_comments(news_id, created_at);
CREATE TABLE IF NOT EXISTS news_comment_reactions (
  comment_id INTEGER NOT NULL REFERENCES news_comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);
CREATE TABLE IF NOT EXISTS news_comment_flags (
  comment_id INTEGER NOT NULL REFERENCES news_comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);
CREATE TABLE IF NOT EXISTS news_comment_locks (news_id INTEGER PRIMARY KEY);
`);

interface CRow {
  id: number; news_id: number; parent_id: number | null; user_id: number; text: string; status: string; hide_reason: string;
  pinned: number; created_at: number; edited_at: number | null; username: string; role: string;
}

const enabled = () => getSetting('news_comments') !== '0';
const published = (newsId: number): boolean => {
  const r = db.prepare('SELECT status FROM news WHERE id = ? AND test = 0').get(newsId) as { status: string } | undefined;
  return !!r && (r.status === 'sent' || r.status === 'edit_queued');
};
const isStaff = (role: string) => role === 'admin' || role === 'moderator';

/** nicks mentioned in a text (@name), only the ones that are accounts, at most 5, never the author */
export function mentionedUsers(text: string, authorId: number): { id: number; username: string }[] {
  const names = [...new Set([...text.matchAll(/(?:^|[\s(])@([\p{L}\p{N}_.-]{2,32})/gu)].map((m) => m[1].toLowerCase()))].slice(0, 5);
  const find = db.prepare('SELECT id, username FROM users WHERE LOWER(username) = ?');
  const out: { id: number; username: string }[] = [];
  for (const n of names) {
    const u = find.get(n) as { id: number; username: string } | undefined;
    if (u && u.id !== authorId) out.push(u);
  }
  return out;
}

/** a line in the inbox; an unread one of the same kind for the same link is updated instead of repeated (3 new comments) */
function notify(userId: number, kind: string, url: string, text: string, collapse?: (n: number) => string, title = 'Новости'): void {
  const now = Date.now();
  if (collapse) {
    const old = db.prepare("SELECT id, text FROM user_notifications WHERE user_id = ? AND kind = ? AND url = ? AND read = 0 ORDER BY id DESC LIMIT 1").get(userId, kind, url) as { id: number; text: string } | undefined;
    if (old) {
      const n = Number(/\((\d+)\)$/.exec(old.text)?.[1] ?? 1) + 1;
      db.prepare('UPDATE user_notifications SET text = ?, ts = ? WHERE id = ?').run(`${collapse(n)} (${n})`, now, old.id);
      return;
    }
  }
  db.prepare('INSERT INTO user_notifications (user_id, ts, kind, server_id, text, url) VALUES (?, ?, ?, NULL, ?, ?)').run(userId, now, kind, collapse ? `${text} (1)` : text, url);
  pushToUser(userId, { title, body: text, url, tag: `${kind}-${url}` });
}

const titleOf = (newsId: number): string => {
  try {
    const r = db.prepare('SELECT payload FROM news WHERE id = ?').get(newsId) as { payload: string } | undefined;
    const p = r ? (JSON.parse(r.payload) as { embed?: { title?: string }; content?: string }) : null;
    return (p?.embed?.title || p?.content || `Новость №${newsId}`).slice(0, 60);
  } catch {
    return `Новость №${newsId}`;
  }
};

export function commentCount(newsId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM news_comments WHERE news_id = ? AND status = 'visible'").get(newsId) as { n: number }).n;
}

const SELECT = 'SELECT c.*, u.username, u.role FROM news_comments c JOIN users u ON u.id = c.user_id';

function thread(newsId: number, viewerId: number | null, staff: boolean) {
  const all = db.prepare(`${SELECT} WHERE c.news_id = ? ORDER BY c.created_at, c.id LIMIT ${MAX_THREAD}`).all(newsId) as CRow[];
  // a deleted comment stays as a stub only while it has replies under it
  const parents = new Set(all.filter((r) => r.status !== 'deleted' && r.parent_id).map((r) => r.parent_id));
  const rows = all.filter((r) => r.status !== 'deleted' || parents.has(r.id));
  const react = db.prepare('SELECT comment_id, emoji, user_id FROM news_comment_reactions WHERE comment_id IN (SELECT id FROM news_comments WHERE news_id = ?)').all(newsId) as { comment_id: number; emoji: string; user_id: number }[];
  const flags = db.prepare('SELECT comment_id, user_id FROM news_comment_flags WHERE comment_id IN (SELECT id FROM news_comments WHERE news_id = ?)').all(newsId) as { comment_id: number; user_id: number }[];
  const counts = new Map<number, Record<string, number>>();
  const mine = new Map<number, string>();
  for (const r of react) {
    const c = counts.get(r.comment_id) ?? {};
    c[r.emoji] = (c[r.emoji] ?? 0) + 1;
    counts.set(r.comment_id, c);
    if (r.user_id === viewerId) mine.set(r.comment_id, r.emoji);
  }
  const flagged = new Set(flags.filter((f) => f.user_id === viewerId).map((f) => f.comment_id));
  const flagN = new Map<number, number>();
  for (const f of flags) flagN.set(f.comment_id, (flagN.get(f.comment_id) ?? 0) + 1);
  return rows.map((r) => {
    const hidden = r.status === 'hidden';
    const gone = r.status === 'deleted';
    const own = viewerId === r.user_id;
    return {
      id: r.id,
      parentId: r.parent_id,
      author: r.username,
      role: isStaff(r.role) ? r.role : 'user',
      mine: own,
      // a hidden comment shows its text to staff and to the author only
      text: (hidden && !staff && !own) || gone ? '' : r.text,
      hidden,
      deleted: gone,
      hideReason: hidden ? r.hide_reason : '',
      pinned: !!r.pinned,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      canEdit: own && !hidden && !gone && Date.now() - r.created_at <= EDIT_WINDOW_MS,
      reactions: counts.get(r.id) ?? {},
      myReaction: mine.get(r.id) ?? null,
      flagged: flagged.has(r.id),
      flags: staff ? flagN.get(r.id) ?? 0 : undefined,
    };
  });
}

const staffOf = (req: AuthedRequest) => !!req.user && (req.user.role === 'admin' || req.user.role === 'moderator');

router.get('/api/news/comments/settings', newsStaff, (_req, res) => res.json({ enabled: enabled() }));
router.put('/api/news/comments/settings', newsStaff, (req, res) => {
  const b = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  setSetting('news_comments', b.data.enabled ? '1' : '0');
  res.json({ enabled: enabled() });
});

router.get('/api/news/comments/mentions', auth, (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase().replace(/[%_]/g, '').slice(0, 32);
  if (!q) return res.json([]);
  const rows = db.prepare("SELECT username FROM users WHERE LOWER(username) LIKE ? ORDER BY username LIMIT 6").all(`${q}%`) as { username: string }[];
  res.json(rows.map((r) => r.username));
});

router.get('/api/news/discussed', viewer, (_req, res) => {
  const since = Date.now() - 14 * 86_400_000;
  const rows = db
    .prepare("SELECT news_id, COUNT(*) AS n FROM news_comments WHERE status = 'visible' AND created_at > ? GROUP BY news_id ORDER BY n DESC, MAX(created_at) DESC LIMIT 12")
    .all(since) as { news_id: number; n: number }[];
  res.json(rows.filter((r) => published(r.news_id)).slice(0, 5).map((r) => ({ id: r.news_id, title: titleOf(r.news_id), comments: r.n })));
});

router.get('/api/news/comments/queue', moderator, (_req, res) => {
  const rows = db
    .prepare(`${SELECT} WHERE c.status <> 'deleted' AND (c.status = 'hidden' OR EXISTS (SELECT 1 FROM news_comment_flags f WHERE f.comment_id = c.id)) ORDER BY (c.status = 'hidden'), c.created_at DESC LIMIT 200`)
    .all() as CRow[];
  const flagN = db.prepare('SELECT COUNT(*) AS n FROM news_comment_flags WHERE comment_id = ?');
  res.json(rows.map((r) => ({
    id: r.id, newsId: r.news_id, title: titleOf(r.news_id), author: r.username, text: r.text, status: r.status, hideReason: r.hide_reason,
    createdAt: r.created_at, flags: (flagN.get(r.id) as { n: number }).n,
  })));
});

router.get('/api/news/comments/count', moderator, (_req, res) => {
  res.json({ open: (db.prepare("SELECT COUNT(*) AS n FROM news_comments c WHERE c.status = 'visible' AND EXISTS (SELECT 1 FROM news_comment_flags f WHERE f.comment_id = c.id)").get() as { n: number }).n });
});

router.post('/api/news/comments/bulk', moderator, (req, res) => {
  const b = z.object({ ids: z.array(z.number().int().positive()).min(1).max(100), action: z.enum(['approve', 'hide', 'delete']), reason: z.string().trim().max(200).optional() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  const mark = (ids: number[]) => ids.map(() => '?').join(',');
  db.transaction(() => {
    const ids = b.data.ids;
    if (b.data.action === 'approve') {
      db.prepare(`DELETE FROM news_comment_flags WHERE comment_id IN (${mark(ids)})`).run(...ids);
      db.prepare(`UPDATE news_comments SET status = 'visible', hide_reason = '' WHERE status = 'hidden' AND id IN (${mark(ids)})`).run(...ids);
    } else if (b.data.action === 'hide') {
      db.prepare(`UPDATE news_comments SET status = 'hidden', hide_reason = ? WHERE status = 'visible' AND id IN (${mark(ids)})`).run(b.data.reason ?? '', ...ids);
      db.prepare(`DELETE FROM news_comment_flags WHERE comment_id IN (${mark(ids)})`).run(...ids);
    } else {
      db.prepare(`UPDATE news_comments SET status = 'deleted', text = '', pinned = 0 WHERE id IN (${mark(ids)})`).run(...ids);
      db.prepare(`DELETE FROM news_comment_flags WHERE comment_id IN (${mark(ids)})`).run(...ids);
    }
  })();
  res.json({ ok: true });
});

router.get('/api/news/:id/comments', param('id'), viewer, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!published(id) && !staffOf(req)) return res.status(404).json({ error: 'Новость не найдена' });
  const locked = !!db.prepare('SELECT 1 FROM news_comment_locks WHERE news_id = ?').get(id);
  const on = enabled();
  res.json({
    enabled: on,
    locked,
    canPost: on && !locked && !!req.user,
    staff: staffOf(req),
    items: on ? thread(id, req.user?.id ?? null, staffOf(req)) : [],
  });
});

router.put('/api/news/:id/comments/lock', param('id'), newsStaff, (req, res) => {
  const b = z.object({ locked: z.boolean() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  const id = Number(req.params.id);
  if (b.data.locked) db.prepare('INSERT OR IGNORE INTO news_comment_locks (news_id) VALUES (?)').run(id);
  else db.prepare('DELETE FROM news_comment_locks WHERE news_id = ?').run(id);
  res.json({ locked: b.data.locked });
});

router.post('/api/news/:id/comments', param('id'), auth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!published(id)) return res.status(404).json({ error: 'Новость не найдена' });
  if (!enabled() || db.prepare('SELECT 1 FROM news_comment_locks WHERE news_id = ?').get(id)) return res.status(403).json({ error: 'Комментарии к этой новости закрыты' });
  const b = z.object({ text: z.string().trim().min(1).max(MAX_LEN), parentId: z.number().int().positive().optional() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Комментарий: от 1 до 1000 символов' });
  const me = req.user!;
  const recent = (db.prepare('SELECT COUNT(*) AS n FROM news_comments WHERE user_id = ? AND created_at > ?').get(me.id, Date.now() - BURST_MS) as { n: number }).n;
  if (recent >= BURST && me.role === 'player') return res.status(429).json({ error: 'Слишком много комментариев подряд. Подождите немного' });
  let parent: CRow | undefined;
  if (b.data.parentId) {
    parent = db.prepare(`${SELECT} WHERE c.id = ?`).get(b.data.parentId) as CRow | undefined;
    if (!parent || parent.news_id !== id || parent.status === 'deleted') return res.status(400).json({ error: 'Ответить можно только на комментарий к этой же новости' });
  }
  // replies stay one level deep: an answer to an answer goes under the same top comment
  const parentId = parent ? parent.parent_id ?? parent.id : null;
  if (db.prepare("SELECT 1 FROM news_comments WHERE user_id = ? AND news_id = ? AND text = ? AND status <> 'deleted' AND created_at > ?").get(me.id, id, b.data.text, Date.now() - 60 * 60_000)) {
    return res.status(409).json({ error: 'Такой комментарий уже есть' });
  }
  const now = Date.now();
  const cid = Number(db.prepare('INSERT INTO news_comments (news_id, parent_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)').run(id, parentId, me.id, b.data.text, now).lastInsertRowid);
  const url = `/news/${id}#c-${cid}`;
  const title = titleOf(id);
  const told = new Set<number>([me.id]);
  if (parent && parent.user_id !== me.id) {
    told.add(parent.user_id);
    notify(parent.user_id, 'news_reply', url, `${me.username} ответил на ваш комментарий к «${title}»`);
  }
  for (const u of mentionedUsers(b.data.text, me.id)) {
    if (told.has(u.id)) continue;
    told.add(u.id);
    notify(u.id, 'news_mention', url, `${me.username} упомянул вас в комментарии к «${title}»`);
  }
  const owner = (db.prepare('SELECT created_by FROM news WHERE id = ?').get(id) as { created_by: number | null } | undefined)?.created_by;
  if (owner && !told.has(owner)) {
    const text = `Новые комментарии к «${title}»`;
    notify(owner, 'news_comment', `/news/${id}#comments`, text, () => text, 'Комментарии');
  }
  res.status(201).json({ id: cid });
});

const load = (cid: number) => db.prepare(`${SELECT} WHERE c.id = ?`).get(cid) as CRow | undefined;

router.patch('/api/news/comments/:cid', param('cid'), auth, (req: AuthedRequest, res) => {
  const row = load(Number(req.params.cid));
  if (!row || row.status === 'deleted') return res.status(404).json({ error: 'Комментарий не найден' });
  if (row.user_id !== req.user!.id) return res.status(403).json({ error: 'Это не ваш комментарий' });
  if (row.status !== 'visible' || Date.now() - row.created_at > EDIT_WINDOW_MS) return res.status(403).json({ error: 'Править комментарий можно в течение 10 минут' });
  const b = z.object({ text: z.string().trim().min(1).max(MAX_LEN) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Комментарий: от 1 до 1000 символов' });
  db.prepare('UPDATE news_comments SET text = ?, edited_at = ? WHERE id = ?').run(b.data.text, Date.now(), row.id);
  res.json({ ok: true });
});

router.delete('/api/news/comments/:cid', param('cid'), auth, (req: AuthedRequest, res) => {
  const row = load(Number(req.params.cid));
  if (!row || row.status === 'deleted') return res.status(404).json({ error: 'Комментарий не найден' });
  if (row.user_id !== req.user!.id) return res.status(403).json({ error: 'Это не ваш комментарий' });
  db.prepare("UPDATE news_comments SET status = 'deleted', text = '', pinned = 0 WHERE id = ?").run(row.id);
  db.prepare('DELETE FROM news_comment_flags WHERE comment_id = ?').run(row.id);
  res.json({ ok: true });
});

router.put('/api/news/comments/:cid/reaction', param('cid'), auth, (req: AuthedRequest, res) => {
  const row = load(Number(req.params.cid));
  if (!row || row.status !== 'visible') return res.status(404).json({ error: 'Комментарий не найден' });
  const b = z.object({ emoji: z.enum(EMOJI).nullable() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверная реакция' });
  if (b.data.emoji === null) db.prepare('DELETE FROM news_comment_reactions WHERE comment_id = ? AND user_id = ?').run(row.id, req.user!.id);
  else db.prepare('INSERT INTO news_comment_reactions (comment_id, user_id, emoji) VALUES (?, ?, ?) ON CONFLICT(comment_id, user_id) DO UPDATE SET emoji = excluded.emoji').run(row.id, req.user!.id, b.data.emoji);
  res.json({ ok: true });
});

router.post('/api/news/comments/:cid/flag', param('cid'), auth, (req: AuthedRequest, res) => {
  const row = load(Number(req.params.cid));
  if (!row || row.status !== 'visible') return res.status(404).json({ error: 'Комментарий не найден' });
  if (row.user_id === req.user!.id) return res.status(403).json({ error: 'Это ваш комментарий' });
  db.prepare('INSERT OR IGNORE INTO news_comment_flags (comment_id, user_id, ts) VALUES (?, ?, ?)').run(row.id, req.user!.id, Date.now());
  res.json({ ok: true });
});

router.post('/api/news/comments/:cid/hide', param('cid'), moderator, (req: AuthedRequest, res) => {
  const row = load(Number(req.params.cid));
  if (!row || row.status === 'deleted') return res.status(404).json({ error: 'Комментарий не найден' });
  const b = z.object({ reason: z.string().trim().max(200).default(''), restore: z.boolean().optional() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  if (b.data.restore) db.prepare("UPDATE news_comments SET status = 'visible', hide_reason = '' WHERE id = ?").run(row.id);
  else {
    db.prepare("UPDATE news_comments SET status = 'hidden', hide_reason = ?, pinned = 0 WHERE id = ?").run(b.data.reason, row.id);
    db.prepare('DELETE FROM news_comment_flags WHERE comment_id = ?').run(row.id);
    if (row.user_id !== req.user!.id) notify(row.user_id, 'news_hidden', `/news/${row.news_id}#c-${row.id}`, `Ваш комментарий к «${titleOf(row.news_id)}» скрыт модератором${b.data.reason ? `: ${b.data.reason}` : ''}`);
  }
  res.json({ ok: true });
});

router.post('/api/news/comments/:cid/pin', param('cid'), moderator, (req: AuthedRequest, res) => {
  const row = load(Number(req.params.cid));
  if (!row || row.status !== 'visible') return res.status(404).json({ error: 'Комментарий не найден' });
  if (row.parent_id) return res.status(400).json({ error: 'Закрепить можно только основной комментарий' });
  const b = z.object({ pinned: z.boolean() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  db.transaction(() => {
    if (b.data.pinned) db.prepare('UPDATE news_comments SET pinned = 0 WHERE news_id = ?').run(row.news_id);
    db.prepare('UPDATE news_comments SET pinned = ? WHERE id = ?').run(b.data.pinned ? 1 : 0, row.id);
  })();
  res.json({ ok: true });
});
