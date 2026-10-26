/**
 * Community polls: created in the panel, voted on the site or with buttons in Discord.
 *   GET    /api/polls               (signed in) the latest polls with results and the user's own vote
 *   POST   /api/polls/:id/vote      { optionId } — one vote per user, changeable until the poll closes
 *   POST   /api/polls               (admin) { question, options[2..10], closesAt?, channelId? } — posts it to the channel
 *   POST   /api/polls/:id/close     (admin) closes it and posts the results
 *   DELETE /api/polls/:id           (admin)
 *   POST   /internal/polls/vote     the bot: a button press { pollId, optionId, discordId }
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { enqueueAlert } from './alerts.js';
import { type AuthedRequest } from './auth.js';
import { db } from './db.js';
import { log } from './logger.js';
import { pollIsOpen, resultsText, tally, validatePoll, type TallyRow } from './communityPollLogic.js';
import { publicBase } from './site.js';

db.exec(`
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  closes_at INTEGER,
  closed INTEGER NOT NULL DEFAULT 0,
  channel_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  pos INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  voted_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);
`);

interface PollRow { id: number; question: string; closes_at: number | null; closed: number; channel_id: string; created_at: number }
const getPoll = (id: number) => db.prepare('SELECT * FROM polls WHERE id = ?').get(id) as PollRow | undefined;
const optionsOf = (id: number) => db.prepare('SELECT id, text FROM poll_options WHERE poll_id = ? ORDER BY pos').all(id) as { id: number; text: string }[];
const countsOf = (id: number) => new Map((db.prepare('SELECT option_id, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY option_id').all(id) as { option_id: number; n: number }[]).map((r) => [r.option_id, r.n]));
const open = (p: PollRow, now = Date.now()) => pollIsOpen({ closed: !!p.closed, closesAt: p.closes_at }, now);

function view(p: PollRow, userId: number | null) {
  const t = tally(optionsOf(p.id), countsOf(p.id));
  const mine = userId ? (db.prepare('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(p.id, userId) as { option_id: number } | undefined)?.option_id ?? null : null;
  return { id: p.id, question: p.question, closesAt: p.closes_at, closed: !open(p), createdAt: p.created_at, total: t.total, options: t.rows, myVote: mine };
}

const COLOR = { open: 0x5865f2, closed: 0x23a55a };

/** the message of a poll (new / results): also used by the message gallery in the admin */
export function pollEmbed(o: { question: string; closesAt: number | null; rows: TallyRow[]; total: number; isNew: boolean; site: boolean }) {
  return {
    title: o.isNew ? `🗳️ Голосование: ${o.question}` : `📊 Итоги голосования: ${o.question}`,
    description: o.isNew
      ? `Выберите вариант кнопкой ниже${o.site ? ' или на сайте' : ''}. Нужен аккаунт, привязанный к Discord (команда /register).${o.closesAt ? `\nЗавершится <t:${Math.floor(o.closesAt / 1000)}:R>.` : ''}`
      : resultsText(o.rows, o.total),
    color: o.isNew ? COLOR.open : COLOR.closed,
  };
}

function announce(p: PollRow, kind: 'new' | 'result'): void {
  if (!/^\d{15,25}$/.test(p.channel_id)) return;
  const t = tally(optionsOf(p.id), countsOf(p.id));
  const base = publicBase();
  const isNew = kind === 'new';
  enqueueAlert(
    'poll',
    'CoreGSM',
    {
      content: '',
      mention: 'none',
      embed: pollEmbed({ question: p.question, closesAt: p.closes_at, rows: t.rows, total: t.total, isNew, site: !!base }),
      ...(isNew ? { buttons: t.rows.map((r) => ({ customId: `poll:${p.id}:${r.id}`, label: r.text.slice(0, 80) })) } : {}),
      ...(base ? { actions: [{ label: isNew ? 'Голосовать на сайте' : 'Подробнее на сайте', url: `${base}/community` }] } : {}),
    },
    p.channel_id,
  );
}

function closePoll(p: PollRow): void {
  db.prepare('UPDATE polls SET closed = 1 WHERE id = ?').run(p.id);
  announce(p, 'result');
}

/** polls whose time has come are closed (and their results posted) */
export function closeDuePolls(now = Date.now()): number {
  const due = db.prepare('SELECT * FROM polls WHERE closed = 0 AND closes_at IS NOT NULL AND closes_at <= ?').all(now) as PollRow[];
  for (const p of due) closePoll(p);
  return due.length;
}

export function registerPolls({ app, auth, admin, internal }: { app: Express; auth: RequestHandler; admin: RequestHandler; internal: RequestHandler }): void {
  app.get('/api/polls', auth, (req: AuthedRequest, res) => {
    const rows = db.prepare('SELECT * FROM polls ORDER BY closed ASC, id DESC LIMIT 20').all() as PollRow[];
    res.json(rows.map((p) => view(p, req.user!.id)));
  });

  app.post('/api/polls/:id/vote', auth, (req: AuthedRequest, res) => {
    const b = z.object({ optionId: z.number().int() }).safeParse(req.body);
    const p = getPoll(Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'Голосование не найдено' });
    if (!b.success || !optionsOf(p.id).some((o) => o.id === b.data.optionId)) return res.status(400).json({ error: 'Такого варианта нет' });
    if (!open(p)) return res.status(409).json({ error: 'Голосование завершено' });
    db.prepare('INSERT INTO poll_votes (poll_id, user_id, option_id, voted_at) VALUES (?, ?, ?, ?) ON CONFLICT(poll_id, user_id) DO UPDATE SET option_id = excluded.option_id, voted_at = excluded.voted_at').run(p.id, req.user!.id, b.data.optionId, Date.now());
    res.json(view(p, req.user!.id));
  });

  app.post('/api/polls', admin, (req, res) => {
    const b = z
      .object({ question: z.string().max(300), options: z.array(z.string().max(200)).max(20), closesAt: z.number().int().nullable().optional(), channelId: z.string().regex(/^(\d{15,25})?$/).optional() })
      .safeParse(req.body);
    const v = b.success ? validatePoll({ question: b.data.question, options: b.data.options, closesAt: b.data.closesAt ?? null }, Date.now()) : null;
    if (!b.success || !v || !v.ok) return res.status(400).json({ error: 'Проверьте голосование: вопрос от 3 символов, от 2 до 10 разных вариантов, время окончания в будущем' });
    let id = 0;
    db.transaction(() => {
      id = Number(db.prepare('INSERT INTO polls (question, closes_at, channel_id, created_at) VALUES (?, ?, ?, ?)').run(v.question, v.closesAt, b.data.channelId ?? '', Date.now()).lastInsertRowid);
      v.options.forEach((o, i) => db.prepare('INSERT INTO poll_options (poll_id, text, pos) VALUES (?, ?, ?)').run(id, o, i));
    })();
    const p = getPoll(id)!;
    announce(p, 'new');
    res.status(201).json(view(p, null));
  });

  app.post('/api/polls/:id/close', admin, (req, res) => {
    const p = getPoll(Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'Голосование не найдено' });
    if (!p.closed) closePoll(p);
    res.json(view({ ...p, closed: 1 }, null));
  });

  app.delete('/api/polls/:id', admin, (req, res) => {
    db.prepare('DELETE FROM polls WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // a button under the message in Discord
  app.post('/internal/polls/vote', internal, (req, res) => {
    const b = z.object({ pollId: z.number().int(), optionId: z.number().int(), discordId: z.string().regex(/^\d{15,25}$/) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad body' });
    const p = getPoll(b.data.pollId);
    if (!p || !optionsOf(p.id).some((o) => o.id === b.data.optionId)) return res.json({ status: 'notfound' });
    if (!open(p)) return res.json({ status: 'closed', text: resultsText(...(() => { const t = tally(optionsOf(p.id), countsOf(p.id)); return [t.rows, t.total] as const; })()) });
    const u = db.prepare("SELECT id FROM users WHERE discord_id = ? AND status = 'active'").get(b.data.discordId) as { id: number } | undefined;
    if (!u) return res.json({ status: 'unlinked' });
    db.prepare('INSERT INTO poll_votes (poll_id, user_id, option_id, voted_at) VALUES (?, ?, ?, ?) ON CONFLICT(poll_id, user_id) DO UPDATE SET option_id = excluded.option_id, voted_at = excluded.voted_at').run(p.id, u.id, b.data.optionId, Date.now());
    const t = tally(optionsOf(p.id), countsOf(p.id));
    res.json({ status: 'ok', text: resultsText(t.rows, t.total) });
  });

  const tick = () => {
    try {
      closeDuePolls();
    } catch (e) {
      log.error('closing polls failed', (e as Error).message);
    }
  };
  setTimeout(tick, 45_000).unref();
  setInterval(tick, 60_000).unref();
}
