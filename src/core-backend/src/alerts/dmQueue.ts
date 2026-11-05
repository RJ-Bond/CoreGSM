/**
 * Sends the private cards of the bot: the person's language, the quiet hours (a morning digest instead of night alerts),
 * the muted servers and the grouping of several alerts about one server into one card.
 */
import type { Express, Request, RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { brand, logoFile, publicBase } from '../admin/site.js';
import { chartSign } from '../images/serverChart.js';
import { prefsOf } from '../profile/profileCore.js';
import { enqueueDelivery } from './deliveries.js';
import {
  BYPASS_QUIET, GROUP_WAIT_MS, QUIET_OFF, type Ctx, type DmCard, type Quiet, type ServerData, type ServerEvent,
  digestCard, digestLine, inQuiet, localHour, normQuiet, quietEnd, serverCard,
} from './dmCard.js';

db.exec(`
CREATE TABLE IF NOT EXISTS dm_quiet (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  from_hour INTEGER NOT NULL DEFAULT -1,
  to_hour INTEGER NOT NULL DEFAULT -1
);
CREATE TABLE IF NOT EXISTS dm_mutes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL,
  until INTEGER NOT NULL,
  PRIMARY KEY (user_id, server_id)
);
`);

export const quietOf = (userId: number): Quiet => {
  const r = db.prepare('SELECT from_hour AS "from", to_hour AS "to" FROM dm_quiet WHERE user_id = ?').get(userId) as Quiet | undefined;
  return r ? normQuiet(r) : QUIET_OFF;
};

export const isMuted = (userId: number, serverId: number, now = Date.now()): boolean =>
  !!db.prepare('SELECT 1 FROM dm_mutes WHERE user_id = ? AND server_id = ? AND until > ?').get(userId, serverId, now);

export function ctxOf(userId: number): Ctx {
  const b = publicBase() ?? '';
  return { lang: prefsOf(userId).lang, base: b, brand: brand().name || 'CoreGSM', ...(b && logoFile() ? { logoUrl: `${b}/api/branding/logo?v=${brand().logoV}` } : {}) };
}

interface Row {
  id: number;
  payload: string;
}

/** a still waiting delivery of the same group for this person */
function waiting(discordId: string, group: string): Row | undefined {
  return db
    .prepare("SELECT id, payload FROM deliveries WHERE kind = 'dm' AND target = ? AND status = 'pending' AND json_extract(payload, '$.group') = ? ORDER BY id DESC LIMIT 1")
    .get(discordId, group) as Row | undefined;
}

function put(discordId: string, card: DmCard, extra: Record<string, unknown>, delayMs: number): void {
  enqueueDelivery({ kind: 'dm', refId: null, target: discordId, payload: { embed: card.embed, actions: card.actions, buttons: card.buttons, summary: card.summary, ...extra }, delayMs });
}

/** holds the card until the quiet time is over; everything held for one person goes into one morning card */
function toDigest(userId: number, discordId: string, c: Ctx, card: DmCard, q: Quiet, tz: string, now: number): void {
  const group = `dig:${userId}`;
  const line = digestLine(card.summary, now);
  const w = waiting(discordId, group);
  if (w) {
    const p = JSON.parse(w.payload) as { lines: string[]; since: number };
    const lines = [...p.lines, line].slice(-60);
    const dc = digestCard(c, { lines, since: p.since });
    db.prepare('UPDATE deliveries SET payload = ? WHERE id = ?').run(JSON.stringify({ embed: dc.embed, actions: dc.actions, buttons: dc.buttons, summary: dc.summary, group, lines, since: p.since }), w.id);
    return;
  }
  const dc = digestCard(c, { lines: [line], since: now });
  put(discordId, dc, { group, lines: [line], since: now }, Math.max(0, quietEnd(now, q, tz) - now));
}

/** Queues a ready card for a person. `kind` decides whether the quiet hours apply. Returns false when it was dropped. */
export function queueCard(o: { userId: number; discordId: string; kind: string; card: (c: Ctx) => DmCard; serverId?: number }, now = Date.now()): boolean {
  if (o.serverId !== undefined && isMuted(o.userId, o.serverId, now)) return false;
  const c = ctxOf(o.userId);
  const card = o.card(c);
  const q = quietOf(o.userId);
  const tz = prefsOf(o.userId).timezone;
  if (!BYPASS_QUIET.has(o.kind) && inQuiet(localHour(now, tz), q)) {
    toDigest(o.userId, o.discordId, c, card, q, tz, now);
    return true;
  }
  put(o.discordId, card, {}, 0);
  return true;
}

/** An alert about a server: alerts about the same server that arrive within a few seconds become one card. */
export function queueServerAlert(o: { userId: number; discordId: string; data: Omit<ServerData, 'events' | 'imageUrl'>; event: ServerEvent }, now = Date.now()): boolean {
  const { userId, discordId, data, event } = o;
  if (isMuted(userId, data.serverId, now)) return false;
  const c = ctxOf(userId);
  const imageUrl = c.base ? `${c.base}/api/server-chart/${data.serverId}-${chartSign(data.serverId)}.png?v=${Math.floor(now / 600_000)}` : undefined;
  const q = quietOf(userId);
  const tz = prefsOf(userId).timezone;
  if (inQuiet(localHour(now, tz), q)) {
    toDigest(userId, discordId, c, serverCard(c, { ...data, events: [event] }), q, tz, now);
    return true;
  }
  const group = `srv:${data.serverId}`;
  const w = waiting(discordId, group);
  if (w) {
    const p = JSON.parse(w.payload) as { events: ServerEvent[] };
    const events = [...p.events, event].slice(-8);
    const card = serverCard(c, { ...data, events, ...(imageUrl ? { imageUrl } : {}) });
    db.prepare('UPDATE deliveries SET payload = ? WHERE id = ?').run(JSON.stringify({ embed: card.embed, actions: card.actions, buttons: card.buttons, summary: card.summary, group, events }), w.id);
    return true;
  }
  const card = serverCard(c, { ...data, events: [event], ...(imageUrl ? { imageUrl } : {}) });
  put(discordId, card, { group, events: [event] }, GROUP_WAIT_MS);
  return true;
}

// ---------- routes ----------
export function registerDmQueue(deps: { app: Express; auth: RequestHandler; internal: RequestHandler; userId: (req: Request) => number }): void {
  const { app, auth, internal, userId } = deps;

  app.get('/api/me/dm-quiet', auth, (req, res) => res.json(quietOf(userId(req))));
  app.put('/api/me/dm-quiet', auth, (req, res) => {
    const b = z.object({ from: z.number().int().min(-1).max(23), to: z.number().int().min(-1).max(23) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте часы' });
    const q = normQuiet(b.data);
    db.prepare('INSERT INTO dm_quiet (user_id, from_hour, to_hour) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET from_hour = excluded.from_hour, to_hour = excluded.to_hour').run(userId(req), q.from, q.to);
    res.json(q);
  });

  // «🔕 Заглушить это» under a card: the bot passes the Discord id of the person
  app.post('/internal/dm/mute', internal, (req, res) => {
    const b = z.object({ discordId: z.string().regex(/^\d{15,25}$/), serverId: z.number().int().min(1), hours: z.number().int().min(1).max(24 * 30).default(24) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad body' });
    const u = db.prepare('SELECT id FROM users WHERE discord_id = ?').get(b.data.discordId) as { id: number } | undefined;
    if (!u) return res.status(404).json({ error: 'not linked' });
    const until = Date.now() + b.data.hours * 3600_000;
    db.prepare('INSERT INTO dm_mutes (user_id, server_id, until) VALUES (?, ?, ?) ON CONFLICT(user_id, server_id) DO UPDATE SET until = excluded.until').run(u.id, b.data.serverId, until);
    db.prepare('DELETE FROM dm_mutes WHERE until < ?').run(Date.now());
    res.json({ ok: true, until, lang: prefsOf(u.id).lang });
  });
}
