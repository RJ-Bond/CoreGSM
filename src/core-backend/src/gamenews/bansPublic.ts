/**
 * The «Баны» page: the bans that the game plugin has put in force, as a list for the panel.
 *   GET /api/bans?server=<id>&q=<nick>   whoever may open the panel (a closed panel: signed-in people only)
 * A guest and a player see the nickname, the reason, the server, the day and until when. The game account (platform id) and the name of the
 * administrator who gave the ban are shown to the staff only. A short block after a kick is not a ban and is not listed.
 */
import type { Express, Request } from 'express';
import { z } from 'zod';
import { type AuthedRequest, rateLimit, staff, viewer, isStaff } from '../security/auth.js';
import { activeBanByNick, holdsOn, listBans, logMod, removeBan, type BanRow } from './gameNewsModLog.js';
import { bus } from '../events.js';
import { pushLater } from '../alerts/push.js';
import { serverLabel } from './gameNewsVars.js';
import type { BanHistoryItem, BansData as BansAnswer, PublicBan } from '../shared/bans.js';

export type { BanHistoryItem, BansAnswer, PublicBan };
import { db } from '../db.js';

/** the list in the shape that is given out: the staff sees more */
export function shapeBans(rows: BanRow[], opts: { staff: boolean; server?: number; q?: string; label?: (id: number) => string }): PublicBan[] {
  const label = opts.label ?? serverLabel;
  const q = (opts.q ?? '').trim().toLowerCase();
  return rows
    .filter((r) => r.kind === 'ban')
    .filter((r) => opts.server === undefined || holdsOn(r, opts.server))
    .filter((r) => !q || r.nick.toLowerCase().includes(q) || r.reason.toLowerCase().includes(q))
    .map((r): PublicBan => ({
      nick: r.nick,
      reason: r.reason,
      serverId: r.server_id,
      server: r.server_id ? label(r.server_id) : '',
      scope: r.scope === 'server' ? 'server' : 'all',
      createdAt: r.created_at,
      until: r.until,
      ...(opts.staff ? { admin: r.admin, platformId: r.platform_id } : {}),
    }));
}

export function registerBans(app: Express): void {
  registerBanExtras(app);
  app.get('/api/bans', viewer, (req: Request, res) => {
    const now = Date.now();
    const all = listBans(now).filter((r) => r.kind === 'ban');
    const serverQ = Number(req.query.server);
    const server = Number.isInteger(serverQ) && serverQ > 0 ? serverQ : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 60) : '';
    const staff = isStaff(req);
    const items = shapeBans(all, { staff, server, q }).slice(0, 500);
    // the servers that have bans (the filter) and the figures over all of them, whatever the filter says
    const counts = new Map<number, number>();
    for (const r of all) if (r.server_id) counts.set(r.server_id, (counts.get(r.server_id) ?? 0) + 1);
    const week = (db.prepare("SELECT COUNT(*) AS n FROM game_mod_log WHERE kind = 'ban' AND ts >= ?").get(now - 7 * 86_400_000) as { n: number }).n;
    const out: BansAnswer = {
      total: all.length,
      forever: all.filter((r) => r.until === 0).length,
      last7d: week,
      servers: [...counts.entries()].map(([id, count]) => ({ id, name: serverLabel(id), count })).sort((a, b) => b.count - a.count),
      items,
    };
    res.set('Cache-Control', 'private, max-age=15');
    res.json(out);
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the history of the bans, the appeals of the banned and the push of the staff about both

interface LogRow { ts: number; kind: string; nick: string; reason: string; server_id: number; until: number; admin: string }

/** the log of the moderation reduced to bans and unbans, newest first; the administrator is named to the staff only */
export function banHistory(opts: { staff: boolean; now: number; limit?: number; server?: number; label?: (id: number) => string }): BanHistoryItem[] {
  const label = opts.label ?? serverLabel;
  const rows = db.prepare("SELECT ts, kind, nick, reason, server_id, until, admin FROM game_mod_log WHERE kind IN ('ban', 'unban') ORDER BY id DESC LIMIT ?").all(Math.min(300, Math.max(1, opts.limit ?? 100))) as LogRow[];
  return rows
    .filter((r) => opts.server === undefined || r.server_id === opts.server)
    .map((r): BanHistoryItem => ({
      kind: r.kind === 'unban' ? 'unban' : 'ban',
      nick: r.nick,
      reason: r.reason,
      serverId: r.server_id,
      server: r.server_id ? label(r.server_id) : '',
      at: r.ts,
      until: r.until,
      expired: r.kind === 'ban' && r.until !== 0 && r.until <= opts.now,
      ...(opts.staff ? { admin: r.admin } : {}),
    }));
}

interface AppealRow { user_id?: number | null; id: number; ts: number; nick: string; platform_id: string; text: string; contact: string; status: string; note: string; decided_by: string | null; decided_at: number | null }

const appealOut = (r: AppealRow) => ({ id: r.id, at: r.ts, nick: r.nick, platformId: r.platform_id, text: r.text, contact: r.contact, status: r.status, note: r.note, decidedBy: r.decided_by, decidedAt: r.decided_at });

/** the staff that wants a push about new bans and appeals: the signed-in people who switched it on and still are staff */
function alertUsers(): number[] {
  return (db.prepare("SELECT a.user_id AS id FROM ban_alerts a JOIN users u ON u.id = a.user_id WHERE u.status = 'active' AND u.role IN ('admin', 'moderator')").all() as { id: number }[]).map((r) => r.id);
}

export function registerBanExtras(app: Express): void {
  app.get('/api/bans/history', viewer, (req: Request, res) => {
    const serverQ = Number(req.query.server);
    const items = banHistory({ staff: isStaff(req), now: Date.now(), server: Number.isInteger(serverQ) && serverQ > 0 ? serverQ : undefined });
    res.set('Cache-Control', 'private, max-age=15').json({ items });
  });

  // an appeal: a banned player says why the ban should go. Only for a nickname that has a ban in force; one open appeal per nickname.
  app.post('/api/bans/appeals', viewer, rateLimit(5), (req: Request, res) => {
    const b = z.object({ nick: z.string().trim().min(1).max(100), text: z.string().trim().min(10).max(1000), contact: z.string().trim().max(100).optional() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
    const now = Date.now();
    const ban = activeBanByNick(b.data.nick, now);
    if (!ban) return res.status(404).json({ error: 'Для этого ника нет действующего бана' });
    const open = db.prepare("SELECT id FROM ban_appeals WHERE ulower(nick) = ulower(?) AND status = 'open'").get(ban.nick);
    if (open) return res.status(409).json({ error: 'Заявка на этот ник уже отправлена и ждёт ответа' });
    const uid = (req as AuthedRequest).user?.id ?? null;
    const info = db.prepare('INSERT INTO ban_appeals (ts, nick, platform_id, text, contact, user_id) VALUES (?, ?, ?, ?, ?, ?)').run(now, ban.nick, ban.platform_id, b.data.text, b.data.contact ?? '', uid);
    for (const id of alertUsers()) pushLater(id, { title: 'Заявка на разбан', body: `${ban.nick}: ${b.data.text.slice(0, 120)}`, url: '/admin/gamenews/players', tag: 'ban-appeal' });
    res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
  });

  app.get('/api/bans/appeals', staff, (req, res) => {
    const status = typeof req.query.status === 'string' && ['open', 'accepted', 'rejected'].includes(req.query.status) ? req.query.status : '';
    const rows = db.prepare(`SELECT * FROM ban_appeals ${status ? 'WHERE status = ?' : ''} ORDER BY (status = 'open') DESC, ts DESC LIMIT 200`).all(...(status ? [status] : [])) as AppealRow[];
    res.json(rows.map(appealOut));
  });

  // the decision: accepted (and the ban is lifted at once if the staff says so) or rejected, with a note for the log
  app.patch('/api/bans/appeals/:id', staff, (req: AuthedRequest, res) => {
    const b = z.object({ status: z.enum(['accepted', 'rejected']), note: z.string().trim().max(300).optional(), unban: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
    const row = db.prepare('SELECT * FROM ban_appeals WHERE id = ?').get(Number(req.params.id)) as AppealRow | undefined;
    if (!row) return res.status(404).json({ error: 'Заявка на разбан не найдена' });
    const now = Date.now();
    const who = req.user?.username ?? '';
    db.prepare('UPDATE ban_appeals SET status = ?, note = ?, decided_by = ?, decided_at = ? WHERE id = ?').run(b.data.status, b.data.note ?? '', who, now, row.id);
    if (b.data.status === 'accepted' && b.data.unban && row.platform_id) {
      const gone = removeBan(row.platform_id);
      if (gone) logMod({ kind: 'unban', platformId: gone.platform_id, nick: gone.nick, admin: who, reason: 'по заявке', serverId: gone.server_id }, now);
    }
    // a signed-in author hears the answer: the bell and the devices
    if (row.user_id) {
      const lifted = b.data.status === 'accepted' && b.data.unban && !!row.platform_id;
      const text = b.data.status === 'accepted' ? `Заявка на разбан принята${lifted ? ': бан снят' : ''}.` : `Заявка на разбан отклонена${b.data.note ? `: ${b.data.note}` : '.'}`;
      db.prepare('INSERT INTO user_notifications (user_id, ts, kind, server_id, text, url) VALUES (?, ?, ?, NULL, ?, ?)').run(row.user_id, now, 'ban_appeal', text, '/bans');
      pushLater(row.user_id, { title: 'Заявка на разбан', body: text, url: '/bans', tag: `ban-appeal-${row.id}` });
    }
    res.json({ ok: true });
  });

  // «a push to me about new bans and appeals»: a switch of every member of the staff
  app.get('/api/bans/alerts', staff, (req: AuthedRequest, res) => {
    res.json({ on: !!db.prepare('SELECT 1 FROM ban_alerts WHERE user_id = ?').get(req.user!.id) });
  });
  app.put('/api/bans/alerts', staff, (req: AuthedRequest, res) => {
    const b = z.object({ on: z.boolean() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
    if (b.data.on) db.prepare('INSERT OR IGNORE INTO ban_alerts (user_id) VALUES (?)').run(req.user!.id);
    else db.prepare('DELETE FROM ban_alerts WHERE user_id = ?').run(req.user!.id);
    res.json({ on: b.data.on });
  });

  bus.on('ban.created', (e) => {
    const until = e.until === 0 ? 'навсегда' : `до ${new Date(e.until).toLocaleDateString('ru-RU')}`;
    for (const id of alertUsers()) pushLater(id, { title: `Бан: ${e.nick}`, body: `${until}${e.reason ? ` · ${e.reason.slice(0, 100)}` : ''}`, url: '/bans', tag: 'ban-new' });
  });
}
