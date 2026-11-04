/**
 * The player's own data: a download of everything the panel keeps about the account, and deleting the account.
 *
 *   GET    /api/me/export   one JSON file (no password hashes, session tokens or push keys)
 *   DELETE /api/me          deletes the account; asks for the password (or the user name, for an account made through
 *                           Discord that has no password); the last administrator cannot be deleted
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { auth, type AuthedRequest } from '../security/auth.js';
import { clearSessionCookie, windowLimiter } from '../security/security.js';
import { db } from '../db.js';
import { hasTable } from '../schema.js';
import { wrap } from '../http.js';
import { removeAvatar } from '../images/avatars.js';
import { removeBanner } from '../profile/profile.js';
import { log } from '../logger.js';

export const router = express.Router();

const rows = (sql: string, ...args: unknown[]): unknown[] => db.prepare(sql).all(...args);

/** everything the panel keeps about one account, as plain data */
export function exportAccount(id: number): Record<string, unknown> {
  const u = db.prepare('SELECT username, role, email, email_verified, created_at, discord_name, status FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  const out: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    account: u ?? null,
    preferences: db.prepare('SELECT lang, timezone, time_format, date_format, banner_preset FROM user_prefs WHERE user_id = ?').get(id) ?? null,
    player: db.prepare('SELECT game_nick, bio, public_profile, privacy FROM user_player WHERE user_id = ?').get(id) ?? null,
    favouriteServers: rows('SELECT s.id, s.name FROM favorites f JOIN servers s ON s.id = f.server_id WHERE f.user_id = ?', id),
    journal: rows('SELECT ts, kind, ip, ua, detail FROM account_events WHERE user_id = ? ORDER BY ts DESC LIMIT 1000', id),
  };
  if (hasTable(db, 'player_follows')) out.followedPlayers = rows('SELECT nick, created_at FROM player_follows WHERE user_id = ?', id);
  if (hasTable(db, 'favorite_push_prefs')) out.favouritePushPrefs = db.prepare('SELECT on_online, on_free_slot, on_down FROM favorite_push_prefs WHERE user_id = ?').get(id) ?? null;
  const nick = (db.prepare('SELECT game_nick FROM user_player WHERE user_id = ?').get(id) as { game_nick: string } | undefined)?.game_nick;
  if (nick) {
    out.playSessions = rows(
      `SELECT s.name AS server, ps.joined_at, ps.left_at FROM player_sessions ps JOIN servers s ON s.id = ps.server_id
       WHERE ulower(ps.name) = ulower(?) ORDER BY ps.joined_at DESC LIMIT 5000`,
      nick,
    );
  }
  return out;
}

router.get('/api/me/export', auth, windowLimiter(10, 3600_000), (req: AuthedRequest, res) => {
  const name = String(req.user!.username ?? 'account').replace(/[^\w.-]+/g, '_').slice(0, 40) || 'account';
  res.set({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="coregsm-${name}.json"`,
    'Cache-Control': 'no-store',
  });
  res.send(JSON.stringify(exportAccount(req.user!.id), null, 2));
});

router.delete(
  '/api/me',
  auth,
  windowLimiter(5, 3600_000),
  wrap(async (req: AuthedRequest, res) => {
    const body = z.object({ password: z.string().max(256).optional(), confirm: z.string().max(64).optional() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Проверьте введённые данные' });
    const id = req.user!.id;
    const u = db.prepare('SELECT username, role, status, password_hash, no_password FROM users WHERE id = ?').get(id) as
      | { username: string; role: string; status: string; password_hash: string; no_password: number }
      | undefined;
    if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
    if (u.role === 'admin' && u.status === 'active') {
      const n = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get() as { n: number }).n;
      if (n <= 1) return res.status(409).json({ error: 'Нельзя удалить последнего администратора' });
    }
    if (u.no_password) {
      if ((body.data.confirm ?? '').trim().toLowerCase() !== u.username.toLowerCase()) return res.status(403).json({ error: 'Введите имя аккаунта для подтверждения' });
    } else if (!(await bcrypt.compare(body.data.password ?? '', u.password_hash))) {
      return res.status(403).json({ error: 'Пароль неверен' });
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    removeAvatar(id);
    removeBanner(id);
    log.info(`Account deleted by its owner: ${u.username}`);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  }),
);
