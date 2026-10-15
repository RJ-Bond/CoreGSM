/**
 * Notifications on the devices of signed-in players (the panel installed as an app, or the browser tab closed):
 * the same notices as the in-panel inbox (a full server got a free slot, a server came back or went down).
 *
 *   GET    /api/push/key        the panel's public key, for subscribing in the browser
 *   POST   /api/push/subscribe  remember this device (a signed-in user)
 *   DELETE /api/push/subscribe  forget this device
 *   POST   /api/push/test       send a test notification to all of the user's devices
 */
import express from 'express';
import { z } from 'zod';
import { auth, type AuthedRequest, rateLimit } from './auth.js';
import { db } from './db.js';
import { publicBase } from './site.js';
import { setPushHook } from './subscriptions.js';
import { sendPush, vapidKeys } from './webpush.js';

export const router = express.Router();

db.exec(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_ok INTEGER,
  fails INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
`);

/** devices are removed after this many failed sends in a row */
const MAX_FAILS = 10;
const subject = () => publicBase() ?? 'mailto:admin@coregsm.local';

export interface PushMessage { title: string; body: string; url?: string; tag?: string }

/** sends to every device of a user; never throws (the poller calls it) */
export async function pushToUser(userId: number, m: PushMessage): Promise<number> {
  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId) as { id: number; endpoint: string; p256dh: string; auth: string }[];
  let sent = 0;
  for (const s of subs) {
    const r = await sendPush(s, { ...m }, subject());
    if (r === 'sent') {
      sent++;
      db.prepare('UPDATE push_subscriptions SET last_ok = ?, fails = 0 WHERE id = ?').run(Date.now(), s.id);
    } else if (r === 'gone') {
      db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
    } else {
      db.prepare('UPDATE push_subscriptions SET fails = fails + 1 WHERE id = ?').run(s.id);
      db.prepare('DELETE FROM push_subscriptions WHERE id = ? AND fails >= ?').run(s.id, MAX_FAILS);
    }
  }
  return sent;
}

/** fire and forget, for code that must not wait */
export const pushLater = (userId: number, m: PushMessage) => void pushToUser(userId, m).catch(() => undefined);
setPushHook(pushLater);

router.get('/api/push/key', (_req, res) => res.json({ publicKey: vapidKeys().publicKey }));

const subSchema = z.object({
  endpoint: z.string().url().max(800).refine((u) => u.startsWith('https://') || u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/) }),
});

router.post('/api/push/subscribe', auth, rateLimit(30), (req: AuthedRequest, res) => {
  const b = subSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, fails = 0`,
  ).run(req.user!.id, b.data.endpoint, b.data.keys.p256dh, b.data.keys.auth, Date.now());
  res.json({ ok: true, devices: (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(req.user!.id) as { n: number }).n });
});

router.delete('/api/push/subscribe', auth, (req: AuthedRequest, res) => {
  const endpoint = String((req.body as { endpoint?: unknown } | undefined)?.endpoint ?? '');
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.user!.id, endpoint);
  res.json({ ok: true });
});

router.post('/api/push/test', auth, rateLimit(10), async (req: AuthedRequest, res) => {
  const sent = await pushToUser(req.user!.id, { title: 'CoreGSM', body: 'Уведомления работают: сюда придут вести о ваших серверах.', url: '/profile', tag: 'test' });
  res.json({ sent });
});
