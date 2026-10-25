/** User management (administrators). */
import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { admin, type AuthedRequest, parsePerms, PERMS, type Role } from '../auth.js';
import { avatarFor, removeAvatar } from '../avatars.js';
import { db } from '../db.js';
import { wrap } from '../http.js';
import { logAccount, removeBanner } from '../profile.js';

export const router = express.Router();

// ---------- user management (administrators) ----------
const adminCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get() as { n: number }).n;

router.get('/api/users', admin, (_req, res) => {
  const rows = db.prepare('SELECT id, username, role, perms, created_at, status, discord_name, discord_id, discord_avatar FROM users ORDER BY (status = \'pending\') DESC, id').all() as {
    id: number;
    username: string;
    role: Role;
    perms: string | null;
    created_at: number | null;
    status: string;
    discord_name: string | null;
    discord_id: string | null;
    discord_avatar: string | null;
  }[];
  res.json(rows.map((u) => ({ id: u.id, username: u.username, role: u.role, perms: u.role === 'moderator' ? parsePerms(u.perms) : u.role === 'admin' ? [...PERMS] : [], createdAt: u.created_at, status: u.status, discordName: u.discord_name, avatarUrl: avatarFor(u) })));
});

router.post('/api/users/:id/approve', admin, (req, res) => {
  const r = db.prepare("UPDATE users SET status = 'active' WHERE id = ? AND status = 'pending'").run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Заявка не найдена' });
  res.json({ ok: true });
});

router.put('/api/users/:id', admin, (req: AuthedRequest, res) => {
  const b = z.object({ role: z.enum(['admin', 'moderator', 'player']), perms: z.array(z.enum(PERMS)).max(PERMS.length).optional() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверная роль' });
  const id = Number(req.params.id);
  const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as { id: number; role: Role } | undefined;
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  if (u.role === 'admin' && b.data.role !== 'admin' && adminCount() <= 1) return res.status(409).json({ error: 'Нельзя снять права с последнего администратора' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.data.role, id);
  // the permissions matter for a moderator only; not sent: the ones already set stay
  if (b.data.perms) db.prepare('UPDATE users SET perms = ? WHERE id = ?').run(JSON.stringify([...new Set(b.data.perms)]), id);
  res.json({ ok: true });
});

router.put(
  '/api/users/:id/password',
  admin,
  wrap(async (req, res) => {
    const b = z.object({ password: z.string().min(8).max(256) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });
    const id = Number(req.params.id);
    const r = db.prepare('UPDATE users SET password_hash = ?, no_password = 0 WHERE id = ?').run(await bcrypt.hash(b.data.password, 12), id);
    if (!r.changes) return res.status(404).json({ error: 'Пользователь не найден' });
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    logAccount(req, id, 'password_changed', 'сброшен администратором');
    res.json({ ok: true });
  }),
);

router.delete('/api/users/:id', admin, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) return res.status(409).json({ error: 'Нельзя удалить собственную учётную запись' });
  const u = db.prepare('SELECT role, status FROM users WHERE id = ?').get(id) as { role: Role; status: string } | undefined;
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  if (u.role === 'admin' && u.status === 'active' && adminCount() <= 1) return res.status(409).json({ error: 'Нельзя удалить последнего администратора' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  removeAvatar(id);
  removeBanner(id);
  res.json({ ok: true });
});
