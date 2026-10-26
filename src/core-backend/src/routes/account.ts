/** Sign-in, first-run setup, registration and the signed-in user (profile, password, sessions, favourites). */
import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { decryptSecret, encryptSecret } from '../secrets.js';
import { newRecoveryCodes, newSecret, otpauthUri, useRecoveryCode, verifyCode } from '../totp.js';
import { accountLockRemaining, accountLoginFailed, accountLoginOk, auth, type AuthedRequest, avatarUrl, DUMMY_HASH, issueToken, loginLimiter, permsOf, rateLimit, registrationOpen, resetAttempts, type Role, type UserFull } from '../auth.js';
import { customAvatarUrl } from '../avatars.js';
import { SETUP_TOKEN } from '../config.js';
import { activeBan } from '../banLogic.js';
import { db, setSetting } from '../db.js';
import { safeEqual, wrap } from '../http.js';
import { bannerPresetOf, bannerUrlOf, logAccount, prefsOf } from '../profile.js';
import { BOT_TOKEN_RE, normalizeProxy, PROXY_HELP, PROXY_RE, TOKEN_HELP } from '../proxyInput.js';
import { clearSessionCookie, emailChanged, ipLockRemaining, ipLoginFailed, noteLogin, recentNewDevice, setSessionCookie, windowLimiter } from '../security.js';
import { recordConsent } from '../rules.js';
import { brand, needsSetup, publicBase, registrationMode, rememberAdminBase, rulesText } from '../site.js';
import { unreadNotifications } from '../subscriptions.js';
import { log } from '../logger.js';

export const router = express.Router();

router.post(
  '/api/auth/login',
  loginLimiter,
  wrap(async (req, res) => {
    const body = z.object({ username: z.string().trim().max(64), password: z.string().max(256), code: z.string().trim().max(32).optional() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Неверные данные' });
    // progressive lockout of the whole address after failures across several logins
    const ipWait = ipLockRemaining(req.ip);
    if (ipWait > 0) {
      res.setHeader('Retry-After', String(ipWait));
      return res.status(429).json({ error: `Слишком много неудачных попыток входа с этого адреса. Повторите через ${ipWait} с.`, retryAfter: ipWait });
    }
    // lock out after repeated wrong passwords for the same login from the same address
    const retryAfter = accountLockRemaining(req.ip, body.data.username);
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `Слишком много неверных попыток. Повторите через ${retryAfter} с.`, retryAfter });
    }
    const u = db.prepare('SELECT * FROM users WHERE ulower(username) = ?').get(body.data.username.toLowerCase()) as
      | { id: number; username: string; password_hash: string; role: Role; status: string; banned_at: number | null; banned_until: number | null; ban_reason: string | null; totp_enabled: number; totp_secret: string | null; totp_recovery: string | null; totp_step: number }
      | undefined;
    const ok = await bcrypt.compare(body.data.password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok) {
      const attemptsLeft = accountLoginFailed(req.ip, body.data.username);
      ipLoginFailed(req.ip, body.data.username);
      if (u) logAccount(req, u.id, 'login_failed');
      return res.status(401).json({ error: 'Неверный логин или пароль', attemptsLeft });
    }
    if (u.status !== 'active') {
      accountLoginOk(req.ip, body.data.username);
      return res.status(403).json({ error: 'Заявка на регистрацию ещё не одобрена администратором', pending: true });
    }
    const ban = activeBan(u, Date.now());
    if (ban) {
      accountLoginOk(req.ip, body.data.username);
      return res.status(403).json({ error: 'Учётная запись заблокирована администратором', banned: true, reason: ban.reason, until: ban.until });
    }
    // second factor: without a code the panel is told to ask for one (no token yet); a wrong code counts like a wrong password
    if (u.totp_enabled && u.totp_secret) {
      if (!body.data.code) return res.json({ twoFactor: true });
      let passed = false;
      try {
        const step = verifyCode(decryptSecret(u.totp_secret), body.data.code, Date.now(), u.totp_step);
        if (step !== null) {
          db.prepare('UPDATE users SET totp_step = ? WHERE id = ?').run(step, u.id);
          passed = true;
        } else {
          const left = useRecoveryCode(JSON.parse(u.totp_recovery || '[]') as string[], body.data.code);
          if (left) {
            db.prepare('UPDATE users SET totp_recovery = ? WHERE id = ?').run(JSON.stringify(left), u.id);
            logAccount(req, u.id, 'profile_changed', '2fa_recovery_used');
            passed = true;
          }
        }
      } catch {
        /* the secret cannot be decrypted (SECRETS_KEY changed): nobody gets in on a guess */
      }
      if (!passed) {
        const attemptsLeft = accountLoginFailed(req.ip, body.data.username);
        ipLoginFailed(req.ip, body.data.username);
        logAccount(req, u.id, 'login_failed', '2fa');
        return res.status(401).json({ error: 'Неверный код подтверждения', attemptsLeft, twoFactor: true });
      }
    }
    accountLoginOk(req.ip, body.data.username);
    resetAttempts(req.ip);
    logAccount(req, u.id, 'login');
    noteLogin(req, u.id, brand().name);
    const token = issueToken(u, req);
    setSessionCookie(req, res, token);
    res.json({ token, username: u.username, role: u.role });
  }),
);

// ---------- first-run setup wizard ----------
router.get('/api/setup/status', (_req, res) => {
  res.json({ needed: needsSetup() });
});

const setupSchema = z.object({
  code: z.string().min(1).max(64),
  // letters (any alphabet), digits, _ . - and single spaces between words; 3-32 characters
  username: z
    .string()
    .trim()
    .regex(/^(?=.{3,32}$)[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u, 'Логин: 3-32 символа: буквы, цифры, пробел между словами, _ . -'),
  password: z.string().min(10, 'Пароль должен быть не короче 10 символов').max(256),
  discordToken: z.string().trim().max(200).optional(),
  proxyUrl: z.string().trim().max(300).optional(),
  proxyType: z.enum(['socks5', 'http']).optional(),
});

router.post(
  '/api/setup',
  loginLimiter,
  wrap(async (req, res) => {
    if (!needsSetup()) return res.status(409).json({ error: 'Панель уже настроена. Войдите под своим логином.' });
    const b = setupSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля формы' });
    if (!safeEqual(b.data.code.trim(), SETUP_TOKEN)) return res.status(403).json({ error: 'Неверный код установки' });
    const proxyUrl = normalizeProxy(b.data.proxyUrl ?? '', b.data.proxyType ?? 'socks5');
    if (proxyUrl && !PROXY_RE.test(proxyUrl)) return res.status(400).json({ error: PROXY_HELP });
    if (b.data.discordToken && !BOT_TOKEN_RE.test(b.data.discordToken)) return res.status(400).json({ error: TOKEN_HELP });

    const hash = await bcrypt.hash(b.data.password, 12);
    let userId = 0;
    try {
      db.transaction(() => {
        // re-check inside the transaction so two concurrent requests cannot both create an admin
        if (!needsSetup()) throw new Error('already-setup');
        userId = Number(db.prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)").run(b.data.username, hash, Date.now()).lastInsertRowid);
        if (b.data.discordToken) setSetting('discord_token', b.data.discordToken);
        if (proxyUrl) setSetting('proxy_url', proxyUrl);
      })();
    } catch {
      return res.status(409).json({ error: 'Панель уже настроена. Войдите под своим логином.' });
    }
    resetAttempts(req.ip);
    log.info(`setup completed, admin "${b.data.username}" created`);
    const token = issueToken({ id: userId, username: b.data.username }, req);
    setSessionCookie(req, res, token);
    noteLogin(req, userId, brand().name);
    res.status(201).json({ token, username: b.data.username, role: 'admin' });
  }),
);

// ---------- registration of players ----------
const USERNAME_RE = /^(?=.{3,32}$)[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u;

router.get('/api/auth/check', rateLimit(30), (req, res) => {
  const name = String(req.query.username ?? '').trim();
  const valid = USERNAME_RE.test(name);
  const available = valid && !db.prepare('SELECT 1 FROM users WHERE ulower(username) = ?').get(name.toLowerCase());
  res.json({ valid, available });
});

router.post(
  '/api/auth/register',
  windowLimiter(20, 3600_000, 'Слишком много регистраций с этого адреса. Попробуйте позже.'),
  loginLimiter,
  wrap(async (req, res) => {
    if (needsSetup()) return res.status(409).json({ error: 'Панель ещё не настроена: сначала создайте администратора' });
    if (!registrationOpen()) return res.status(403).json({ error: 'Регистрация закрыта администратором' });
    const b = z
      .object({
        username: z.string().trim().regex(USERNAME_RE, 'Логин: 3-32 символа: буквы, цифры, пробел между словами, _ . -'),
        password: z.string().min(8, 'Пароль должен быть не короче 8 символов').max(256),
        acceptRules: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля формы' });
    if (rulesText() && !b.data.acceptRules) return res.status(400).json({ error: 'Нужно согласиться с правилами сообщества' });
    if (db.prepare('SELECT 1 FROM users WHERE ulower(username) = ?').get(b.data.username.toLowerCase())) {
      return res.status(409).json({ error: 'Этот логин уже занят' });
    }
    const hash = await bcrypt.hash(b.data.password, 12);
    const pending = registrationMode() === 'approval';
    try {
      const id = Number(
        db.prepare("INSERT INTO users (username, password_hash, role, created_at, status) VALUES (?, ?, 'player', ?, ?)").run(b.data.username, hash, Date.now(), pending ? 'pending' : 'active').lastInsertRowid,
      );
      if (rulesText()) recordConsent(id, 'web');
      if (pending) return res.status(202).json({ pending: true });
      const token = issueToken({ id, username: b.data.username }, req);
      setSessionCookie(req, res, token);
      noteLogin(req, id, brand().name);
      res.status(201).json({ token, username: b.data.username, role: 'player' });
    } catch {
      res.status(409).json({ error: 'Этот логин уже занят' });
    }
  }),
);

// ---------- favourites (any signed-in user) ----------
router.get('/api/favorites', auth, (req: AuthedRequest, res) => {
  const rows = db.prepare('SELECT server_id FROM favorites WHERE user_id = ?').all(req.user!.id) as { server_id: number }[];
  res.json(rows.map((r) => r.server_id));
});
router.put('/api/favorites/:id', auth, (req: AuthedRequest, res) => {
  const sid = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(sid)) return res.status(404).json({ error: 'Сервер не найден' });
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, server_id) VALUES (?, ?)').run(req.user!.id, sid);
  res.json({ ok: true });
});
router.delete('/api/favorites/:id', auth, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND server_id = ?').run(req.user!.id, Number(req.params.id));
  res.json({ ok: true });
});

// who signs a news item: the Discord display name exactly as it is written there (case included) and the Discord
// picture when the account is linked, otherwise the site login and the uploaded picture (as an absolute address,
// Discord has to fetch it)
router.get('/api/me/author', auth, (req: AuthedRequest, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserFull;
  const base = publicBase();
  if (u.discord_id && u.discord_name) {
    const hash = u.discord_avatar;
    const icon = hash
      ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=128`
      : null;
    return res.json({ name: u.discord_name, iconUrl: icon, source: 'discord' });
  }
  const custom = customAvatarUrl(u.id);
  res.json({ name: u.username, iconUrl: custom && base ? `${base}${custom}` : null, source: 'site' });
});

router.get('/api/me', auth, (req: AuthedRequest, res) => {
  if (req.user!.role === 'admin') rememberAdminBase(req);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserFull;
  // an uploaded picture wins over the Discord avatar
  const custom = customAvatarUrl(u.id);
  res.json({
    username: u.username,
    role: u.role,
    perms: permsOf({ id: u.id, role: u.role }),
    avatarUrl: custom ?? avatarUrl(u),
    avatarSource: custom ? 'custom' : avatarUrl(u) ? 'discord' : null,
    discordName: u.discord_name,
    hasPassword: !u.no_password,
    email: u.email ?? null,
    emailVerified: !!u.email && !!u.email_verified,
    newDevice: recentNewDevice(u.id),
    prefs: prefsOf(u.id),
    bannerUrl: bannerUrlOf(u.id),
    bannerPreset: bannerPresetOf(u.id),
    unreadNotifications: unreadNotifications(u.id),
  });
});

// e-mail of the account (a recovery and notification address); changing it asks for the current password
router.put(
  '/api/me/email',
  auth,
  wrap(async (req: AuthedRequest, res) => {
    const body = z.object({ email: z.string().trim().max(254), current: z.string().optional() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Проверьте адрес' });
    const email = body.data.email.toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Некорректный адрес электронной почты' });
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserFull;
    if (!u.no_password && !(await bcrypt.compare(body.data.current ?? '', u.password_hash))) {
      return res.status(403).json({ error: 'Введите текущий пароль, чтобы изменить почту' });
    }
    if (email) {
      const taken = db.prepare('SELECT id FROM users WHERE lower(email) = ? AND id != ?').get(email, req.user!.id);
      if (taken) return res.status(409).json({ error: 'Этот адрес уже привязан к другому аккаунту' });
    }
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email || null, req.user!.id);
    if ((u.email ?? '') !== email) {
      emailChanged(u.id);
      logAccount(req, u.id, 'email_changed');
    }
    res.json({ ok: true, email: email || null });
  }),
);

router.post(
  '/api/auth/password',
  auth,
  wrap(async (req: AuthedRequest, res) => {
    const body = z.object({ current: z.string().optional(), next: z.string().min(8).max(256), confirm: z.string().optional() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Новый пароль должен быть не короче 8 символов' });
    if (body.data.confirm !== undefined && body.data.confirm !== body.data.next) return res.status(400).json({ error: 'Пароли не совпадают' });
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserFull;
    // an account created through Discord has no password yet: no current one to check
    if (!u.no_password && !(await bcrypt.compare(body.data.current ?? '', u.password_hash))) {
      return res.status(403).json({ error: 'Текущий пароль неверен' });
    }
    db.prepare('UPDATE users SET password_hash = ?, no_password = 0 WHERE id = ?').run(bcrypt.hashSync(body.data.next, 12), req.user!.id);
    // other devices have to sign in again with the new password
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user!.id, (req.user as { sid?: string }).sid ?? '');
    logAccount(req, req.user!.id, 'password_changed');
    res.json({ ok: true });
  }),
);

// ---------- two-factor sign-in (TOTP) ----------
const twoFactorRow = (id: number) =>
  db.prepare('SELECT username, password_hash, no_password, totp_secret, totp_enabled, totp_recovery, totp_step FROM users WHERE id = ?').get(id) as {
    username: string; password_hash: string; no_password: number; totp_secret: string | null; totp_enabled: number; totp_recovery: string | null; totp_step: number;
  };

router.get('/api/auth/2fa', auth, (req: AuthedRequest, res) => {
  const u = twoFactorRow(req.user!.id);
  res.json({ enabled: !!u.totp_enabled, recoveryLeft: u.totp_enabled ? (JSON.parse(u.totp_recovery || '[]') as string[]).length : 0, hasPassword: !u.no_password });
});

// step 1: a fresh secret is stored (encrypted, not active yet) and shown once for the authenticator app
router.post('/api/auth/2fa/setup', auth, windowLimiter(20, 3600_000, 'Слишком много попыток. Попробуйте позже.'), (req: AuthedRequest, res) => {
  const u = twoFactorRow(req.user!.id);
  if (u.totp_enabled) return res.status(409).json({ error: 'Двухфакторная защита уже включена' });
  const secret = newSecret();
  db.prepare('UPDATE users SET totp_secret = ?, totp_step = 0 WHERE id = ?').run(encryptSecret(secret), req.user!.id);
  res.json({ secret, uri: otpauthUri(secret, u.username, brand().name || 'CoreGSM') });
});

// step 2: the first valid code turns it on and hands out the recovery codes (shown once)
router.post('/api/auth/2fa/enable', auth, windowLimiter(30, 3600_000, 'Слишком много попыток. Попробуйте позже.'), (req: AuthedRequest, res) => {
  const b = z.object({ code: z.string().max(32) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Введите код из приложения' });
  const u = twoFactorRow(req.user!.id);
  if (u.totp_enabled) return res.status(409).json({ error: 'Двухфакторная защита уже включена' });
  if (!u.totp_secret) return res.status(400).json({ error: 'Сначала начните настройку' });
  let step: number | null = null;
  try {
    step = verifyCode(decryptSecret(u.totp_secret), b.data.code);
  } catch {
    /* unreadable secret: start again */
  }
  if (step === null) return res.status(400).json({ error: 'Код не подошёл. Проверьте время на телефоне и попробуйте ещё раз' });
  const rec = newRecoveryCodes();
  db.prepare('UPDATE users SET totp_enabled = 1, totp_step = ?, totp_recovery = ? WHERE id = ?').run(step, JSON.stringify(rec.hashes), req.user!.id);
  logAccount(req, req.user!.id, 'profile_changed', '2fa_on');
  res.json({ ok: true, recoveryCodes: rec.plain });
});

// turning it off needs the password (when there is one) and a current code or a recovery code
router.post(
  '/api/auth/2fa/disable',
  auth,
  windowLimiter(20, 3600_000, 'Слишком много попыток. Попробуйте позже.'),
  wrap(async (req: AuthedRequest, res) => {
    const b = z.object({ password: z.string().max(256).optional(), code: z.string().max(32) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Введите код из приложения' });
    const u = twoFactorRow(req.user!.id);
    if (!u.totp_enabled) return res.status(409).json({ error: 'Двухфакторная защита не включена' });
    if (!u.no_password && !(await bcrypt.compare(b.data.password ?? '', u.password_hash))) return res.status(403).json({ error: 'Пароль неверен' });
    let ok = false;
    try {
      ok = verifyCode(decryptSecret(u.totp_secret ?? ''), b.data.code, Date.now(), u.totp_step) !== null || useRecoveryCode(JSON.parse(u.totp_recovery || '[]') as string[], b.data.code) !== null;
    } catch {
      /* unreadable secret: only a recovery code can still pass */
      ok = useRecoveryCode(JSON.parse(u.totp_recovery || '[]') as string[], b.data.code) !== null;
    }
    if (!ok) return res.status(400).json({ error: 'Код не подошёл' });
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_recovery = NULL, totp_step = 0 WHERE id = ?').run(req.user!.id);
    logAccount(req, req.user!.id, 'profile_changed', '2fa_off');
    res.json({ ok: true });
  }),
);

router.get('/api/sessions', auth, (req: AuthedRequest, res) => {
  const cur = (req.user as { sid?: string }).sid;
  const rows = db.prepare('SELECT id, created_at, last_seen, ip, ua FROM sessions WHERE user_id = ? ORDER BY last_seen DESC').all(req.user!.id) as {
    id: string;
    created_at: number;
    last_seen: number;
    ip: string;
    ua: string;
  }[];
  res.json(rows.map((s) => ({ id: s.id, createdAt: s.created_at, lastSeen: s.last_seen, ip: s.ip, ua: s.ua, current: s.id === cur })));
});
router.post('/api/sessions/revoke-others', auth, (req: AuthedRequest, res) => {
  const r = db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user!.id, (req.user as { sid?: string }).sid ?? '');
  if (r.changes) logAccount(req, req.user!.id, 'sessions_revoked', `завершено: ${r.changes}`);
  res.json({ ok: true, revoked: r.changes });
});
// logout: ends the session this very token belongs to
router.delete('/api/sessions/current', auth, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(req.user!.sid ?? '', req.user!.id);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});
router.delete('/api/sessions/:id', auth, (req: AuthedRequest, res) => {
  const r = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(String(req.params.id), req.user!.id);
  if (!r.changes) return res.status(404).json({ error: 'Сеанс не найден' });
  logAccount(req, req.user!.id, 'sessions_revoked', 'завершён один сеанс');
  res.json({ ok: true });
});

router.delete('/api/me/discord', auth, (req: AuthedRequest, res) => {
  const u = db.prepare('SELECT no_password FROM users WHERE id = ?').get(req.user!.id) as { no_password: number };
  if (u.no_password) return res.status(409).json({ error: 'Сначала задайте пароль в профиле: иначе войти будет нечем' });
  db.prepare('UPDATE users SET discord_id = NULL, discord_name = NULL, discord_avatar = NULL WHERE id = ?').run(req.user!.id);
  logAccount(req, req.user!.id, 'discord_unlinked');
  res.json({ ok: true });
});
