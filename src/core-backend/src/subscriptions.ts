/**
 * Server subscriptions: a signed-in user asks to be told when
 *   free_slot   a full server (players >= maxPlayers) gets a free slot (once; re-armed when it is full again)
 *   back_online a server that was down is answering again
 *   went_down   a server is confirmed down (two failed polls in a row)
 *
 * The notification lands in the in-panel inbox (user_notifications) and, when the account has a linked Discord
 * id and the bot is online, as a Discord DM through the delivery queue (deliveries.ts, kind 'dm').
 * At most one notification per (user, server, kind) per 10 minutes.
 *
 * gsm.ts calls onPollResult() after every poll; the transition logic itself is pure (nextTrack).
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { db, EFFECTIVE_NAME } from './db.js';
import { enqueueDelivery } from './deliveries.js';

/** device notifications (push.ts plugs itself in, so this module stays free of the web layer) */
type PushHook = (userId: number, m: { title: string; body: string; url?: string; tag?: string }) => void;
let pushLater: PushHook = () => undefined;
export const setPushHook = (fn: PushHook) => { pushLater = fn; };

export const SUB_KINDS = ['free_slot', 'back_online', 'went_down'] as const;
export type SubKind = (typeof SUB_KINDS)[number];

/** minimum gap between two notifications of the same (user, server, kind) */
export const NOTIFY_GAP_MS = 10 * 60_000;
/** failed polls in a row before a server counts as down */
export const CONFIRM_FAILS = 2;

db.exec(`
CREATE TABLE IF NOT EXISTS server_subscriptions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_notified_at INTEGER,
  PRIMARY KEY (user_id, server_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_subs_server ON server_subscriptions(server_id, kind);
CREATE TABLE IF NOT EXISTS user_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  server_id INTEGER,
  text TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON user_notifications(user_id, read, ts);
`);

// ---------- transition logic (pure) ----------

/** what the previous polls of a server added up to */
export interface Track {
  /** the last poll found the server up */
  online: boolean;
  /** the last successful poll found it full */
  full: boolean;
  /** failed polls in a row */
  fails: number;
  /** down is confirmed (fails >= CONFIRM_FAILS) */
  down: boolean;
}
export interface Observation {
  online: boolean;
  players: number;
  maxPlayers: number;
}

export function nextTrack(prev: Track | null, obs: Observation, confirmFails = CONFIRM_FAILS): { next: Track; events: SubKind[] } {
  const events: SubKind[] = [];
  if (obs.online) {
    const full = obs.maxPlayers > 0 && obs.players >= obs.maxPlayers;
    if (prev?.down) events.push('back_online');
    else if (prev?.full && !full) events.push('free_slot');
    return { next: { online: true, full, fails: 0, down: false }, events };
  }
  const fails = (prev?.fails ?? 0) + 1;
  const down = fails >= confirmFails;
  if (down && !prev?.down) events.push('went_down');
  // "full" is kept through failed polls: a server that crashed full and came back with room is a back_online
  return { next: { online: false, full: prev?.full ?? false, fails, down }, events };
}

/** may a notification be sent now, given when the previous one went out? */
export const mayNotify = (lastNotifiedAt: number | null, now: number): boolean => lastNotifiedAt === null || now - lastNotifiedAt >= NOTIFY_GAP_MS;

export function notificationText(kind: SubKind, name: string, address: string, players: number, maxPlayers: number): string {
  const where = address ? ` Адрес: ${address}` : '';
  if (kind === 'free_slot') return `🟢 На сервере «${name}» освободилось место (${players}/${maxPlayers}).${where}`;
  if (kind === 'back_online') return `✅ Сервер «${name}» снова в сети.${where}`;
  return `🔴 Сервер «${name}» недоступен.${where}`;
}

// ---------- delivery ----------

const tracks = new Map<number, Track>();
let canDm: () => boolean = () => true;
/** may a Discord DM be queued now (the bot is online) */
export const dmAvailable = (): boolean => canDm();

/** Notifies the subscribers of one event; returns how many users were notified. */
export function notifySubscribers(serverId: number, kind: SubKind, obs: Observation, now = Date.now()): number {
  const subs = db
    .prepare(
      `SELECT ss.user_id, ss.last_notified_at, u.discord_id FROM server_subscriptions ss
         JOIN users u ON u.id = ss.user_id AND u.status = 'active'
       WHERE ss.server_id = ? AND ss.kind = ?`,
    )
    .all(serverId, kind) as { user_id: number; last_notified_at: number | null; discord_id: string | null }[];
  if (!subs.length) return 0;
  const info = db
    .prepare(`SELECT ${EFFECTIVE_NAME} AS n, s.display_address, s.host, s.port FROM servers s LEFT JOIN status st ON st.server_id = s.id WHERE s.id = ?`)
    .get(serverId) as { n: string; display_address: string; host: string; port: number } | undefined;
  if (!info) return 0;
  const address = info.display_address || `${info.host}:${info.port}`;
  const text = notificationText(kind, info.n, address, obs.players, obs.maxPlayers);
  const insert = db.prepare('INSERT INTO user_notifications (user_id, ts, kind, server_id, text) VALUES (?, ?, ?, ?, ?)');
  const touch = db.prepare('UPDATE server_subscriptions SET last_notified_at = ? WHERE user_id = ? AND server_id = ? AND kind = ?');
  let n = 0;
  for (const s of subs) {
    if (!mayNotify(s.last_notified_at, now)) continue;
    insert.run(s.user_id, now, kind, serverId, text);
    touch.run(now, s.user_id, serverId, kind);
    if (s.discord_id && canDm()) enqueueDelivery({ kind: 'dm', refId: null, target: s.discord_id, payload: { content: text, summary: text.slice(0, 120) } });
    // and on the devices where the player turned notifications on
    pushLater(s.user_id, { title: info.n, body: text, url: `/servers/${serverId}`, tag: `srv-${serverId}-${kind}` });
    n++;
  }
  if (n) db.prepare('DELETE FROM user_notifications WHERE ts < ?').run(now - 60 * 86400_000);
  return n;
}

/** Called by the poller after every poll result. Never throws into the poller's bookkeeping. */
export function onPollResult(serverId: number, obs: Observation): void {
  const { next, events } = nextTrack(tracks.get(serverId) ?? null, obs);
  tracks.set(serverId, next);
  for (const kind of events) notifySubscribers(serverId, kind, obs);
}

export const unreadNotifications = (userId: number): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ? AND read = 0').get(userId) as { n: number }).n;

// ---------- API ----------

export function registerSubscriptions(deps: { app: Express; auth: RequestHandler; userId: (req: import('express').Request) => number; canDm?: () => boolean }): void {
  const { app, auth, userId } = deps;
  if (deps.canDm) canDm = deps.canDm;

  const kindsOf = (uid: number, serverId: number): SubKind[] =>
    (db.prepare('SELECT kind FROM server_subscriptions WHERE user_id = ? AND server_id = ?').all(uid, serverId) as { kind: SubKind }[])
      .map((r) => r.kind)
      .filter((k) => (SUB_KINDS as readonly string[]).includes(k))
      .sort((a, b) => SUB_KINDS.indexOf(a) - SUB_KINDS.indexOf(b));

  app.get('/api/me/subscriptions', auth, (req, res) => {
    const rows = db.prepare('SELECT server_id, kind FROM server_subscriptions WHERE user_id = ? ORDER BY server_id').all(userId(req)) as { server_id: number; kind: SubKind }[];
    const by = new Map<number, SubKind[]>();
    for (const r of rows) by.set(r.server_id, [...(by.get(r.server_id) ?? []), r.kind]);
    res.json([...by].map(([serverId, kinds]) => ({ serverId, kinds })));
  });

  app.put('/api/servers/:id/subscription', auth, (req, res) => {
    const b = z.object({ kinds: z.array(z.enum(SUB_KINDS)).max(SUB_KINDS.length) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Неизвестный тип уведомления' });
    const sid = Number(req.params.id);
    if (!Number.isInteger(sid) || !db.prepare('SELECT 1 FROM servers WHERE id = ?').get(sid)) return res.status(404).json({ error: 'Сервер не найден' });
    const uid = userId(req);
    const want = new Set(b.data.kinds);
    const now = Date.now();
    db.transaction(() => {
      for (const k of SUB_KINDS) {
        if (want.has(k)) db.prepare('INSERT OR IGNORE INTO server_subscriptions (user_id, server_id, kind, created_at) VALUES (?, ?, ?, ?)').run(uid, sid, k, now);
        else db.prepare('DELETE FROM server_subscriptions WHERE user_id = ? AND server_id = ? AND kind = ?').run(uid, sid, k);
      }
    })();
    res.json({ serverId: sid, kinds: kindsOf(uid, sid) });
  });

  // a test: the same message a real event would bring, to the inbox, to Discord and to the devices (once per 20 s)
  const lastTest = new Map<number, number>();
  app.post('/api/servers/:id/subscription/test', auth, (req, res) => {
    const sid = Number(req.params.id);
    const info = Number.isInteger(sid)
      ? (db.prepare(`SELECT ${EFFECTIVE_NAME} AS n, s.display_address, s.host, s.port FROM servers s LEFT JOIN status st ON st.server_id = s.id WHERE s.id = ?`).get(sid) as { n: string; display_address: string; host: string; port: number } | undefined)
      : undefined;
    if (!info) return res.status(404).json({ error: 'Сервер не найден' });
    const uid = userId(req);
    const now = Date.now();
    if (now - (lastTest.get(uid) ?? 0) < 20_000) return res.status(429).json({ error: 'Подождите несколько секунд перед следующей проверкой' });
    lastTest.set(uid, now);
    const text = `🧪 Проверка уведомлений. ${notificationText('back_online', info.n, info.display_address || `${info.host}:${info.port}`, 0, 0)}`;
    db.prepare('INSERT INTO user_notifications (user_id, ts, kind, server_id, text) VALUES (?, ?, ?, ?, ?)').run(uid, now, 'test', sid, text);
    const u = db.prepare('SELECT discord_id FROM users WHERE id = ?').get(uid) as { discord_id: string | null } | undefined;
    const dm = !!u?.discord_id && canDm();
    if (dm) enqueueDelivery({ kind: 'dm', refId: null, target: u!.discord_id as string, payload: { content: text, summary: text.slice(0, 120) } });
    pushLater(uid, { title: info.n, body: text, url: `/servers/${sid}`, tag: `srv-${sid}-test` });
    res.json({ inbox: true, dm, discordLinked: !!u?.discord_id });
  });

  app.get('/api/me/notifications', auth, (req, res) => {
    const uid = userId(req);
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = db
      .prepare(`SELECT id, ts, kind, server_id, text, read FROM user_notifications WHERE user_id = ? ${unreadOnly ? 'AND read = 0' : ''} ORDER BY ts DESC, id DESC LIMIT ?`)
      .all(uid, limit) as { id: number; ts: number; kind: string; server_id: number | null; text: string; read: number }[];
    res.json({
      unread: unreadNotifications(uid),
      items: rows.map((r) => ({ id: r.id, ts: r.ts, kind: r.kind, serverId: r.server_id, text: r.text, read: !!r.read })),
    });
  });

  app.post('/api/me/notifications/read', auth, (req, res) => {
    const b = z
      .object({ ids: z.array(z.number().int()).max(500).optional(), all: z.boolean().optional() })
      .safeParse(req.body);
    if (!b.success || (!b.data.all && !b.data.ids?.length)) return res.status(400).json({ error: 'Укажите ids или all' });
    const uid = userId(req);
    if (b.data.all) db.prepare('UPDATE user_notifications SET read = 1 WHERE user_id = ? AND read = 0').run(uid);
    else {
      const mark = db.prepare('UPDATE user_notifications SET read = 1 WHERE user_id = ? AND id = ?');
      db.transaction(() => b.data.ids!.forEach((id) => mark.run(uid, id)))();
    }
    res.json({ ok: true, unread: unreadNotifications(uid) });
  });
}
