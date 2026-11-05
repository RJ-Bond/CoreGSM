/**
 * «Sudo mode»: a few operations can take over the whole panel or lose its data (restoring a backup, downloading one, the
 * bot token, the mail server, API keys, deleting a server or an account, changing a role). A stolen session cookie must
 * not be enough for them: the signed-in person confirms with the password (and the code of the second factor, when it is
 * on) and the session is then «confirmed» for ten minutes.
 *
 *   GET  /api/auth/reauth   { active, until, method: 'password' | 'name', twoFactor }
 *   POST /api/auth/reauth   { password?, confirm?, code? }   starts the ten minutes for this session
 *
 * `stepUp` is the middleware (after `admin`); `needStepUp(req, res)` is the same check inside a handler, for a route
 * where only some changes need it. The panel answers a refused request (code `reauth_required`) by asking for the
 * password and repeating the request.
 */
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { db } from '../db.js';
import { addColumn } from '../schema.js';
import { decryptSecret } from './secrets.js';
import { useRecoveryCode, verifyCode } from './totp.js';
import { logAccount } from '../profile/profile.js';
import type { AuthedRequest } from './auth.js';
import { windowLimiter } from './security.js';

export const STEP_UP_MS = 10 * 60_000;

addColumn(db, 'sessions', 'sudo_until', 'INTEGER NOT NULL DEFAULT 0');

export const REAUTH_TEXT = 'Это защищённое действие: подтвердите его паролем ещё раз';

export function stepUpActive(sid: string | undefined, now = Date.now()): boolean {
  if (!sid) return false;
  const row = db.prepare('SELECT sudo_until FROM sessions WHERE id = ?').get(sid) as { sudo_until: number } | undefined;
  return !!row && row.sudo_until > now;
}

/** inside a handler: true when the request was refused (the answer is already sent) */
export function needStepUp(req: Request, res: Response): boolean {
  if (stepUpActive((req as AuthedRequest).user?.sid)) return false;
  res.status(403).json({ error: REAUTH_TEXT });
  return true;
}

export const stepUp: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (needStepUp(req, res)) return;
  next();
};

interface Row { username: string; password_hash: string; no_password: number; totp_secret: string | null; totp_enabled: number; totp_step: number; totp_recovery: string | null }

export function registerStepUp(app: Express, auth: RequestHandler): void {
  const limiter = windowLimiter(10, 10 * 60_000, 'Слишком много попыток. Попробуйте позже.');
  const rowOf = (id: number) => db.prepare('SELECT username, password_hash, no_password, totp_secret, totp_enabled, totp_step, totp_recovery FROM users WHERE id = ?').get(id) as Row | undefined;

  app.get('/api/auth/reauth', auth, (req, res) => {
    const u = (req as AuthedRequest).user!;
    const r = rowOf(u.id);
    const until = (db.prepare('SELECT sudo_until FROM sessions WHERE id = ?').get(u.sid ?? '') as { sudo_until: number } | undefined)?.sudo_until ?? 0;
    res.json({ active: until > Date.now(), until, method: r?.no_password ? 'name' : 'password', twoFactor: !!r?.totp_enabled });
  });

  app.post('/api/auth/reauth', auth, limiter, (req, res, next) => {
    void (async () => {
      const u = (req as AuthedRequest).user!;
      const b = z.object({ password: z.string().max(256).optional(), confirm: z.string().max(64).optional(), code: z.string().max(32).optional() }).safeParse(req.body);
      if (!b.success) return void res.status(400).json({ error: 'Проверьте введённые данные' });
      const r = rowOf(u.id);
      if (!r || !u.sid) return void res.status(401).json({ error: 'Требуется вход' });
      if (r.no_password) {
        if ((b.data.confirm ?? '').trim().toLowerCase() !== r.username.toLowerCase()) return void res.status(403).json({ error: 'Введите имя аккаунта для подтверждения' });
      } else if (!(await bcrypt.compare(b.data.password ?? '', r.password_hash))) {
        logAccount(req, u.id, 'login_failed', 'reauth');
        return void res.status(403).json({ error: 'Пароль неверен' });
      }
      if (r.totp_enabled) {
        if (!b.data.code) return void res.status(400).json({ error: 'Введите код из приложения', twoFactor: true });
        let ok = false;
        try {
          const step = verifyCode(decryptSecret(r.totp_secret ?? ''), b.data.code, Date.now(), r.totp_step);
          if (step !== null) {
            db.prepare('UPDATE users SET totp_step = ? WHERE id = ?').run(step, u.id);
            ok = true;
          } else {
            const left = useRecoveryCode(JSON.parse(r.totp_recovery || '[]') as string[], b.data.code);
            if (left) {
              db.prepare('UPDATE users SET totp_recovery = ? WHERE id = ?').run(JSON.stringify(left), u.id);
              ok = true;
            }
          }
        } catch {
          /* an unreadable secret: nobody passes on a guess */
        }
        if (!ok) {
          logAccount(req, u.id, 'login_failed', 'reauth 2fa');
          return void res.status(401).json({ error: 'Неверный код подтверждения', twoFactor: true });
        }
      }
      const until = Date.now() + STEP_UP_MS;
      db.prepare('UPDATE sessions SET sudo_until = ? WHERE id = ?').run(until, u.sid);
      logAccount(req, u.id, 'profile_changed', 'reauth');
      res.json({ ok: true, until });
    })().catch(next);
  });
}
