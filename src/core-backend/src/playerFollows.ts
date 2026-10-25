/**
 * Following a player: a signed-in user asks to be told when a game nick joins any server.
 * The notification goes to the in-panel inbox, to Discord (a DM, when the account is linked and the bot is online)
 * and to the devices with Web Push, like the server subscriptions. One notification per (user, nick) per 30 minutes,
 * so a player who reconnects over and over is not announced over and over.
 *
 *   GET    /api/me/follows            the nicks I follow
 *   PUT    /api/players/:nick/follow  follow (at most 30 nicks)
 *   DELETE /api/players/:nick/follow  stop following
 *
 * gsm.ts calls notifyFollowers() with the sessions a poll has just opened.
 */
import type { Express, Request, RequestHandler } from 'express';
import { db, EFFECTIVE_NAME } from './db.js';
import { enqueueDelivery } from './deliveries.js';
import { dmAvailable, pushToUser } from './subscriptions.js';
import { log } from './logger.js';

export const MAX_FOLLOWS = 30;
/** minimum gap between two notifications about the same nick for the same user */
export const FOLLOW_GAP_MS = 30 * 60_000;

db.exec(`
CREATE TABLE IF NOT EXISTS player_follows (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nick_key TEXT NOT NULL,
  nick TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_notified_at INTEGER,
  PRIMARY KEY (user_id, nick_key)
);
CREATE INDEX IF NOT EXISTS idx_follows_nick ON player_follows(nick_key);
`);

/** the key a nick is compared by: case does not matter */
export const nickKey = (nick: string): string => nick.trim().toLowerCase();

/** a usable nick: 1..64 characters after trimming */
export const validNick = (nick: unknown): nick is string => typeof nick === 'string' && nick.trim().length >= 1 && nick.trim().length <= 64;

export const mayNotifyFollow = (last: number | null, now: number): boolean => last === null || now - last >= FOLLOW_GAP_MS;

export const followText = (nick: string, serverName: string, address: string): string =>
  `🎮 ${nick} зашёл на «${serverName}».${address ? ` Адрес: ${address}` : ''}`;

/** Poller hook: sessions that were just opened. Never throws into the poller. */
export function notifyFollowers(serverId: number, names: string[], now = Date.now()): number {
  try {
    if (!names.length) return 0;
    const keys = [...new Set(names.map(nickKey))];
    const found = db
      .prepare(
        `SELECT f.user_id, f.nick_key, f.last_notified_at, u.discord_id FROM player_follows f
           JOIN users u ON u.id = f.user_id AND u.status = 'active'
         WHERE f.nick_key IN (${keys.map(() => '?').join(',')})`,
      )
      .all(...keys) as { user_id: number; nick_key: string; last_notified_at: number | null; discord_id: string | null }[];
    if (!found.length) return 0;
    const info = db
      .prepare(`SELECT ${EFFECTIVE_NAME} AS n, s.display_address, s.host, s.port FROM servers s LEFT JOIN status st ON st.server_id = s.id WHERE s.id = ?`)
      .get(serverId) as { n: string; display_address: string; host: string; port: number } | undefined;
    if (!info) return 0;
    const address = info.display_address || `${info.host}:${info.port}`;
    const shown = new Map(names.map((n) => [nickKey(n), n]));
    const insert = db.prepare('INSERT INTO user_notifications (user_id, ts, kind, server_id, text) VALUES (?, ?, ?, ?, ?)');
    const touch = db.prepare('UPDATE player_follows SET last_notified_at = ? WHERE user_id = ? AND nick_key = ?');
    let n = 0;
    for (const f of found) {
      if (!mayNotifyFollow(f.last_notified_at, now)) continue;
      const text = followText(shown.get(f.nick_key) ?? f.nick_key, info.n, address);
      insert.run(f.user_id, now, 'player_online', serverId, text);
      touch.run(now, f.user_id, f.nick_key);
      if (f.discord_id && dmAvailable()) enqueueDelivery({ kind: 'dm', refId: null, target: f.discord_id, payload: { content: text, summary: text.slice(0, 120) } });
      pushToUser(f.user_id, { title: info.n, body: text, url: `/servers/${serverId}`, tag: `follow-${f.nick_key}` });
      n++;
    }
    return n;
  } catch (e) {
    log.error('player follows failed', (e as Error).message);
    return 0;
  }
}

export function registerPlayerFollows(deps: { app: Express; auth: RequestHandler; userId: (req: Request) => number }): void {
  const { app, auth, userId } = deps;

  app.get('/api/me/follows', auth, (req, res) => {
    const rows = db.prepare('SELECT nick, created_at FROM player_follows WHERE user_id = ? ORDER BY created_at DESC').all(userId(req)) as { nick: string; created_at: number }[];
    res.json(rows.map((r) => ({ nick: r.nick, createdAt: r.created_at })));
  });

  app.put('/api/players/:nick/follow', auth, (req, res) => {
    const nick = String(req.params.nick ?? '');
    if (!validNick(nick)) return res.status(400).json({ error: 'Укажите ник игрока' });
    const uid = userId(req);
    const key = nickKey(nick);
    const have = db.prepare('SELECT 1 FROM player_follows WHERE user_id = ? AND nick_key = ?').get(uid, key);
    if (!have) {
      const n = (db.prepare('SELECT COUNT(*) AS n FROM player_follows WHERE user_id = ?').get(uid) as { n: number }).n;
      if (n >= MAX_FOLLOWS) return res.status(400).json({ error: `Можно следить не больше чем за ${MAX_FOLLOWS} игроками` });
      db.prepare('INSERT INTO player_follows (user_id, nick_key, nick, created_at) VALUES (?, ?, ?, ?)').run(uid, key, nick.trim(), Date.now());
    }
    res.json({ nick: nick.trim(), following: true });
  });

  app.delete('/api/players/:nick/follow', auth, (req, res) => {
    const nick = String(req.params.nick ?? '');
    if (!validNick(nick)) return res.status(400).json({ error: 'Укажите ник игрока' });
    db.prepare('DELETE FROM player_follows WHERE user_id = ? AND nick_key = ?').run(userId(req), nickKey(nick));
    res.json({ nick: nick.trim(), following: false });
  });
}
