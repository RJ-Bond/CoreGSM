/**
 * Push to the devices of a player about the servers in their favourites ("the server is back", "a slot is free",
 * and, if asked, "the server is down"). The poller calls onFavoritePoll() after every confirmed result; the work is
 * synchronous bookkeeping plus pushLater() (fire and forget), so the poll is never held up.
 *
 *   GET /api/me/favorite-push   my choices and how many devices receive pushes
 *   PUT /api/me/favorite-push   { online?, freeSlot?, down? }
 *
 * A player who already subscribed to the same event of the same server (subscriptions.ts) is skipped there: the
 * subscription delivers it, so nobody gets two pushes.
 */
import type { Express, Request, RequestHandler } from 'express';
import { z } from 'zod';
import { db, EFFECTIVE_NAME } from './db.js';
import { log } from './logger.js';
import { pushToUser } from './subscriptions.js';
import { DEFAULT_FAV_PREFS, type FavEvent, type FavObs, type FavPrefs, type FavTrack, favText, mayPushFav, nextFavTrack, SUBSCRIPTION_KIND } from './favoritePushLogic.js';

const tracks = new Map<number, FavTrack>();
const lastPush = new Map<string, number>();

interface Recipient {
  user_id: number;
}

/** players who have the server in favourites, a device with push, the event switched on and no subscription of their own for it */
function recipients(serverId: number, kind: FavEvent): Recipient[] {
  const col = kind === 'online' ? 'on_online' : kind === 'free_slot' ? 'on_free_slot' : 'on_down';
  const dflt = kind === 'down' ? 0 : 1;
  return db
    .prepare(
      `SELECT f.user_id FROM favorites f
         JOIN users u ON u.id = f.user_id AND u.status = 'active'
         LEFT JOIN favorite_push_prefs p ON p.user_id = f.user_id
       WHERE f.server_id = ? AND COALESCE(p.${col}, ${dflt}) = 1
         AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = f.user_id)
         AND NOT EXISTS (SELECT 1 FROM server_subscriptions ss WHERE ss.user_id = f.user_id AND ss.server_id = f.server_id AND ss.kind = ?)`,
    )
    .all(serverId, SUBSCRIPTION_KIND[kind]) as Recipient[];
}

/** sends one event to the players that want it; returns how many were notified */
export function notifyFavorites(serverId: number, kind: FavEvent, obs: FavObs, now = Date.now()): number {
  const list = recipients(serverId, kind);
  if (!list.length) return 0;
  const info = db.prepare(`SELECT ${EFFECTIVE_NAME} AS n FROM servers s LEFT JOIN status st ON st.server_id = s.id WHERE s.id = ?`).get(serverId) as { n: string } | undefined;
  if (!info) return 0;
  const body = favText(kind, info.n, obs.players, obs.maxPlayers);
  let n = 0;
  for (const r of list) {
    const key = `${r.user_id}:${serverId}:${kind}`;
    if (!mayPushFav(kind, lastPush.get(key), now)) continue;
    lastPush.set(key, now);
    pushToUser(r.user_id, { title: info.n, body, url: `/servers/${serverId}`, tag: `fav-${serverId}-${kind}` });
    n++;
  }
  if (lastPush.size > 20_000) for (const [k, t] of lastPush) if (now - t > 3_600_000) lastPush.delete(k);
  return n;
}

/** Poller hook. `muteDown`: the server is in a maintenance window, nobody is told it went down. Never throws. */
export function onFavoritePoll(serverId: number, obs: FavObs, opts: { muteDown?: boolean; now?: number } = {}): void {
  try {
    const { next, events } = nextFavTrack(tracks.get(serverId) ?? null, obs);
    tracks.set(serverId, next);
    for (const kind of events) {
      if (kind === 'down' && opts.muteDown) continue;
      notifyFavorites(serverId, kind, obs, opts.now);
    }
  } catch (e) {
    log.error('favourite push failed', (e as Error).message);
  }
}

export function favPrefsOf(userId: number): FavPrefs {
  const r = db.prepare('SELECT on_online, on_free_slot, on_down FROM favorite_push_prefs WHERE user_id = ?').get(userId) as { on_online: number; on_free_slot: number; on_down: number } | undefined;
  return r ? { online: !!r.on_online, freeSlot: !!r.on_free_slot, down: !!r.on_down } : { ...DEFAULT_FAV_PREFS };
}

export function registerFavoritePush({ app, auth, userId }: { app: Express; auth: RequestHandler; userId: (req: Request) => number }): void {
  const view = (uid: number) => ({
    ...favPrefsOf(uid),
    devices: (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(uid) as { n: number }).n,
    favorites: (db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?').get(uid) as { n: number }).n,
  });

  app.get('/api/me/favorite-push', auth, (req, res) => res.json(view(userId(req))));

  app.put('/api/me/favorite-push', auth, (req, res) => {
    const b = z.object({ online: z.boolean().optional(), freeSlot: z.boolean().optional(), down: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
    const uid = userId(req);
    const p = { ...favPrefsOf(uid), ...Object.fromEntries(Object.entries(b.data).filter(([, v]) => v !== undefined)) } as FavPrefs;
    db.prepare(
      `INSERT INTO favorite_push_prefs (user_id, on_online, on_free_slot, on_down) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET on_online = excluded.on_online, on_free_slot = excluded.on_free_slot, on_down = excluded.on_down`,
    ).run(uid, p.online ? 1 : 0, p.freeSlot ? 1 : 0, p.down ? 1 : 0);
    res.json(view(uid));
  });
}
