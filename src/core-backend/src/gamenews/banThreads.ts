/**
 * Two things around a ban that the player can feel:
 *  - the conversation under an appeal: the staff may ask a question, the signed-in author answers (the appeal stays open meanwhile);
 *  - the notice that a ban ends soon and that it has ended (to the account the game identity is linked to).
 */
import type { Express } from 'express';
import { z } from 'zod';
import { type AuthedRequest, auth, isStaff, rateLimit, staff } from '../security/auth.js';
import { db } from '../db.js';
import { pushLater } from '../alerts/push.js';
import { enqueueDelivery } from '../alerts/deliveries.js';

export const SOON_MS = 24 * 3_600_000;
const MAX_MESSAGES = 200;

interface Appeal { id: number; nick: string; status: string; user_id: number | null; platform_id: string }
interface Msg { id: number; appeal_id: number; ts: number; side: 'staff' | 'player'; author: string; text: string }

const staffToPush = (): number[] =>
  (db.prepare("SELECT a.user_id AS id FROM ban_alerts a JOIN users u ON u.id = a.user_id WHERE u.status = 'active' AND u.role IN ('admin', 'moderator')").all() as { id: number }[]).map((r) => r.id);

const msgOut = (m: Msg) => ({ id: m.id, at: m.ts, side: m.side, author: m.author, text: m.text });

function notifyUser(userId: number, kind: string, text: string, url: string, tag: string, now: number): void {
  db.prepare('INSERT INTO user_notifications (user_id, ts, kind, server_id, text, url) VALUES (?, ?, ?, NULL, ?, ?)').run(userId, now, kind, text, url);
  pushLater(userId, { title: 'Бан', body: text, url, tag });
}

export function registerBanThreads(app: Express): void {
  /** an appeal and who may read it: the staff, and the signed-in person who sent it */
  const open = (req: AuthedRequest, id: number): { appeal: Appeal; asStaff: boolean } | null => {
    const appeal = db.prepare('SELECT id, nick, status, user_id, platform_id FROM ban_appeals WHERE id = ?').get(id) as Appeal | undefined;
    if (!appeal) return null;
    const asStaff = isStaff(req);
    if (!asStaff && !(req.user && appeal.user_id === req.user.id)) return null;
    return { appeal, asStaff };
  };

  // the appeals of the signed-in person with the number of messages: the «Баны» page shows the conversation under them
  app.get('/api/bans/appeals/mine', auth, (req: AuthedRequest, res) => {
    const rows = db.prepare(
      `SELECT a.id, a.ts, a.nick, a.status, a.note, (SELECT COUNT(*) FROM ban_appeal_messages m WHERE m.appeal_id = a.id) AS messages
       FROM ban_appeals a WHERE a.user_id = ? ORDER BY a.ts DESC LIMIT 20`,
    ).all(req.user!.id) as { id: number; ts: number; nick: string; status: string; note: string; messages: number }[];
    res.json(rows.map((r) => ({ id: r.id, at: r.ts, nick: r.nick, status: r.status, note: r.note, messages: r.messages })));
  });

  app.get('/api/bans/appeals/:id/messages', auth, (req: AuthedRequest, res) => {
    const o = open(req, Number(req.params.id));
    if (!o) return res.status(404).json({ error: 'Заявка не найдена' });
    const rows = db.prepare('SELECT * FROM ban_appeal_messages WHERE appeal_id = ? ORDER BY id LIMIT ?').all(o.appeal.id, MAX_MESSAGES) as Msg[];
    res.json({ appeal: { id: o.appeal.id, nick: o.appeal.nick, status: o.appeal.status, canReply: o.appeal.status === 'open' && (o.asStaff || o.appeal.user_id !== null) }, messages: rows.map(msgOut) });
  });

  app.post('/api/bans/appeals/:id/messages', auth, rateLimit(30), (req: AuthedRequest, res) => {
    const b = z.object({ text: z.string().trim().min(1).max(1000) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Напишите сообщение (до 1000 знаков)' });
    const o = open(req, Number(req.params.id));
    if (!o) return res.status(404).json({ error: 'Заявка не найдена' });
    if (o.appeal.status !== 'open') return res.status(409).json({ error: 'По этой заявке решение уже принято' });
    const n = (db.prepare('SELECT COUNT(*) AS n FROM ban_appeal_messages WHERE appeal_id = ?').get(o.appeal.id) as { n: number }).n;
    if (n >= MAX_MESSAGES) return res.status(409).json({ error: 'В переписке слишком много сообщений' });
    const now = Date.now();
    const side = o.asStaff ? 'staff' : 'player';
    const info = db.prepare('INSERT INTO ban_appeal_messages (appeal_id, ts, side, author, text) VALUES (?, ?, ?, ?, ?)').run(o.appeal.id, now, side, req.user!.username, b.data.text);
    if (side === 'staff') {
      if (o.appeal.user_id) notifyUser(o.appeal.user_id, 'ban_appeal', `Модератор ответил по заявке на разбан: ${b.data.text.slice(0, 120)}`, '/bans', `ban-appeal-${o.appeal.id}`, now);
    } else {
      for (const id of staffToPush()) pushLater(id, { title: `Ответ по заявке: ${o.appeal.nick}`, body: b.data.text.slice(0, 120), url: '/admin/gamenews/players', tag: `ban-appeal-${o.appeal.id}` });
    }
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  // the staff list of appeals gets a counter of messages through this
  app.get('/api/bans/appeals-counts', staff, (_req, res) => {
    const rows = db.prepare("SELECT appeal_id AS id, COUNT(*) AS n, MAX(ts) AS last, SUM(side = 'player') AS fromPlayer FROM ban_appeal_messages GROUP BY appeal_id").all() as { id: number; n: number; last: number; fromPlayer: number }[];
    res.json(Object.fromEntries(rows.map((r) => [r.id, { messages: r.n, last: r.last, fromPlayer: r.fromPlayer }])));
  });
}

// ---- the notice that a ban ends

interface EndingBan { platform_id: string; nick: string; until: number }

/** who is told about a ban of this game account: the account it is linked to (bell, push, a private message in Discord) */
function recipients(platformId: string): { userId: number; discordId: string | null }[] {
  if (!platformId || platformId === '0') return [];
  return db.prepare("SELECT u.id AS userId, u.discord_id AS discordId FROM game_identities g JOIN users u ON u.id = g.user_id WHERE g.platform_id = ? AND u.status = 'active'").all(platformId) as { userId: number; discordId: string | null }[];
}

const told = (platformId: string, until: number, kind: string): boolean => !!db.prepare('SELECT 1 FROM ban_notices WHERE platform_id = ? AND until = ? AND kind = ?').get(platformId, until, kind);
const mark = (platformId: string, until: number, kind: string, now: number): void => { db.prepare('INSERT OR IGNORE INTO ban_notices (platform_id, until, kind, ts) VALUES (?, ?, ?, ?)').run(platformId, until, kind, now); };

function say(r: { userId: number; discordId: string | null }, title: string, text: string, tag: string, now: number): void {
  notifyUser(r.userId, 'ban_end', text, '/bans', tag, now);
  if (r.discordId) {
    try { enqueueDelivery({ kind: 'dm', refId: null, target: r.discordId, payload: { embed: { title, description: text, color: 0xf5b01e, footer: { text: 'CoreGSM' }, timestamp: new Date(now).toISOString() }, actions: [], buttons: [], summary: title } }); } catch { /* the bell is enough */ }
  }
}

/** a ban that ends within a day is announced once; a ban that has ended after that notice is announced once too. Called by the scheduler. */
export function checkBanEnds(now = Date.now()): number {
  let sent = 0;
  const soon = db.prepare("SELECT platform_id, nick, until FROM game_bans WHERE kind = 'ban' AND until > ? AND until <= ?").all(now, now + SOON_MS) as EndingBan[];
  for (const b of soon) {
    if (told(b.platform_id, b.until, 'soon')) continue;
    mark(b.platform_id, b.until, 'soon', now);
    for (const r of recipients(b.platform_id)) { say(r, '⏳ Бан скоро закончится', `Бан ${b.nick} закончится ${new Date(b.until).toLocaleString('ru-RU')}.`, `ban-soon-${b.platform_id}`, now); sent++; }
  }
  // the ones announced earlier and over now (the ban may be already deleted: the notice keeps what is needed)
  const over = db.prepare("SELECT n.platform_id, n.until FROM ban_notices n WHERE n.kind = 'soon' AND n.until <= ? AND NOT EXISTS (SELECT 1 FROM ban_notices e WHERE e.platform_id = n.platform_id AND e.until = n.until AND e.kind = 'ended')").all(now) as { platform_id: string; until: number }[];
  for (const b of over) {
    mark(b.platform_id, b.until, 'ended', now);
    // a ban that was lifted earlier or replaced by a longer one is not «ended»
    const still = db.prepare("SELECT until FROM game_bans WHERE platform_id = ? AND kind = 'ban'").get(b.platform_id) as { until: number } | undefined;
    if (still && (still.until === 0 || still.until > now)) continue;
    const nick = (db.prepare('SELECT nick FROM game_mod_log WHERE platform_id = ? ORDER BY id DESC LIMIT 1').get(b.platform_id) as { nick: string } | undefined)?.nick ?? '';
    for (const r of recipients(b.platform_id)) { say(r, '✅ Бан закончился', `Срок бана${nick ? ` ${nick}` : ''} истёк, можно заходить на сервер.`, `ban-end-${b.platform_id}`, now); sent++; }
  }
  db.prepare('DELETE FROM ban_notices WHERE ts < ?').run(now - 30 * 86_400_000);
  return sent;
}
