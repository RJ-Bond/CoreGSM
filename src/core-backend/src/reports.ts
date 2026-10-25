/**
 * Reports on players: a signed-in user complains about a game nick (cheating, abuse, griefing, other) with a few
 * words; the staff with the «Модерация» permission work through the queue and close each report as done or
 * dismissed, with an optional note. The reporter is told how it ended (the in-panel inbox).
 *   POST  /api/players/:nick/report   send a report (5 per day per user, one open report per user and nick)
 *   GET   /api/reports                the queue (?status=open|closed, default open) (staff)
 *   GET   /api/reports/count          how many are open (staff; the badge of the admin menu)
 *   PATCH /api/reports/:id            close: { status: 'resolved' | 'dismissed', note? } (staff)
 */
import express from 'express';
import { z } from 'zod';
import { allow, auth, type AuthedRequest } from './auth.js';
import { db } from './db.js';
import { param } from './http.js';

export const router = express.Router();
const staff = allow('moderation');

export const REPORT_REASONS = ['cheating', 'abuse', 'griefing', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORTS_PER_DAY = 5;

db.exec(`
CREATE TABLE IF NOT EXISTS player_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nick TEXT NOT NULL,
  nick_key TEXT NOT NULL,
  server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  handled_by TEXT,
  handled_at INTEGER,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON player_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_nick ON player_reports(nick_key, status);
`);

export const VERDICT_TEXT: Record<'resolved' | 'dismissed', string> = {
  resolved: 'Жалоба рассмотрена: меры приняты',
  dismissed: 'Жалоба рассмотрена: нарушений не найдено',
};

/** the message to the reporter when the report is closed */
export function verdictText(status: 'resolved' | 'dismissed', nick: string, note: string): string {
  return `${status === 'resolved' ? '✅' : 'ℹ️'} ${VERDICT_TEXT[status]} (${nick}).${note ? ` Комментарий: ${note}` : ''}`;
}

interface Row {
  id: number; reporter_id: number; nick: string; server_id: number | null; reason: ReportReason; text: string; status: string;
  created_at: number; handled_by: string | null; handled_at: number | null; note: string; reporter: string; server_name: string | null;
  others: number;
}

const out = (r: Row) => ({
  id: r.id,
  nick: r.nick,
  reason: r.reason,
  text: r.text,
  reporter: r.reporter,
  serverId: r.server_id,
  serverName: r.server_name,
  status: r.status,
  createdAt: r.created_at,
  handledBy: r.handled_by,
  handledAt: r.handled_at,
  note: r.note,
  // other open reports on the same nick: a pile of them is a signal
  others: r.others,
});

router.post('/api/players/:nick/report', auth, (req: AuthedRequest, res) => {
  const nick = String(req.params.nick ?? '').trim();
  if (nick.length < 1 || nick.length > 64) return res.status(400).json({ error: 'Укажите ник игрока' });
  const b = z
    .object({ reason: z.enum(REPORT_REASONS), text: z.string().trim().max(500).default(''), serverId: z.number().int().positive().optional() })
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Выберите причину; описание — до 500 символов' });
  const uid = req.user!.id;
  const key = nick.toLowerCase();
  const now = Date.now();
  if (db.prepare("SELECT 1 FROM player_reports WHERE reporter_id = ? AND nick_key = ? AND status = 'open'").get(uid, key)) {
    return res.status(409).json({ error: 'Ваша жалоба на этого игрока уже на рассмотрении' });
  }
  const today = (db.prepare('SELECT COUNT(*) AS n FROM player_reports WHERE reporter_id = ? AND created_at > ?').get(uid, now - 86_400_000) as { n: number }).n;
  if (today >= REPORTS_PER_DAY) return res.status(429).json({ error: `Не больше ${REPORTS_PER_DAY} жалоб в сутки` });
  const serverId = b.data.serverId && db.prepare('SELECT 1 FROM servers WHERE id = ?').get(b.data.serverId) ? b.data.serverId : null;
  const r = db
    .prepare('INSERT INTO player_reports (reporter_id, nick, nick_key, server_id, reason, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uid, nick, key, serverId, b.data.reason, b.data.text, now);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

const SELECT = `SELECT p.*, u.username AS reporter, s.name AS server_name,
  (SELECT COUNT(*) FROM player_reports o WHERE o.nick_key = p.nick_key AND o.status = 'open' AND o.id <> p.id) AS others
  FROM player_reports p JOIN users u ON u.id = p.reporter_id LEFT JOIN servers s ON s.id = p.server_id`;

router.get('/api/reports', staff, (req, res) => {
  const closed = req.query.status === 'closed';
  const rows = db
    .prepare(`${SELECT} WHERE p.status ${closed ? "<> 'open'" : "= 'open'"} ORDER BY ${closed ? 'p.handled_at DESC' : 'p.created_at ASC'} LIMIT 200`)
    .all() as Row[];
  res.json(rows.map(out));
});

router.get('/api/reports/count', staff, (_req, res) => {
  res.json({ open: (db.prepare("SELECT COUNT(*) AS n FROM player_reports WHERE status = 'open'").get() as { n: number }).n });
});

router.patch('/api/reports/:id', param('id'), staff, (req: AuthedRequest, res) => {
  const b = z.object({ status: z.enum(['resolved', 'dismissed']), note: z.string().trim().max(300).default('') }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Укажите решение; комментарий — до 300 символов' });
  const id = Number(req.params.id);
  const row = db.prepare('SELECT reporter_id, nick, status FROM player_reports WHERE id = ?').get(id) as { reporter_id: number; nick: string; status: string } | undefined;
  if (!row) return res.status(404).json({ error: 'Жалоба не найдена' });
  if (row.status !== 'open') return res.status(409).json({ error: 'Жалоба уже рассмотрена' });
  const now = Date.now();
  db.prepare('UPDATE player_reports SET status = ?, handled_by = ?, handled_at = ?, note = ? WHERE id = ?').run(b.data.status, req.user!.username, now, b.data.note, id);
  db.prepare('INSERT INTO user_notifications (user_id, ts, kind, server_id, text) VALUES (?, ?, ?, NULL, ?)').run(row.reporter_id, now, 'report_done', verdictText(b.data.status, row.nick, b.data.note));
  res.json({ ok: true });
});
