/**
 * Registration and profile from Discord slash commands (the bot calls these internal routes).
 * A Discord-registered account is a normal `player` without a password: the Discord identity is the login.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { cleanGameNick, sanitizeLogin, uniqueLogin } from './discordNames.js';
import { achievementsOf, logAccount, vrAchievementsOf, vrHoursOf } from './profile.js';
import { rankForHours } from './ranks.js';

const ATTEMPTS = 5;
const WINDOW_MS = 3600_000;
const attempts = new Map<string, number[]>();

/** true while the Discord id is within its limit; counts the attempt */
function allowAttempt(discordId: string): boolean {
  const now = Date.now();
  const list = (attempts.get(discordId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= ATTEMPTS) {
    attempts.set(discordId, list);
    return false;
  }
  list.push(now);
  attempts.set(discordId, list);
  if (attempts.size > 5000) for (const [k, v] of attempts) if (v.every((t) => now - t >= WINDOW_MS)) attempts.delete(k);
  return true;
}

interface UserRow {
  id: number;
  username: string;
  status: string;
  discord_id: string | null;
  discord_name: string | null;
}

export interface DiscordRegisterDeps {
  app: Express;
  internal: RequestHandler;
  wrap: (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => void;
  publicBase: () => string | null;
  registrationOpen: () => boolean;
  registrationMode: () => 'open' | 'approval';
  rulesText: () => string;
}

export function registerDiscordRegistration(deps: DiscordRegisterDeps): void {
  const { app, internal, wrap } = deps;
  const profileUrl = () => `${deps.publicBase() ?? ''}/#/profile`;
  const byDiscord = (id: string) => db.prepare('SELECT id, username, status, discord_id, discord_name FROM users WHERE discord_id = ?').get(id) as UserRow | undefined;
  const nickOwner = (nick: string, exceptUser: number) =>
    db.prepare('SELECT user_id FROM user_player WHERE ulower(game_nick) = ulower(?) AND user_id != ?').get(nick, exceptUser) as { user_id: number } | undefined;
  const setNick = (userId: number, nick: string) =>
    db
      .prepare(
        `INSERT INTO user_player (user_id, game_nick, bio, public_profile) VALUES (?, ?, '', 0)
         ON CONFLICT(user_id) DO UPDATE SET game_nick = excluded.game_nick`,
      )
      .run(userId, nick);
  const refresh = (id: number, name: string, avatar: string | null) =>
    db.prepare('UPDATE users SET discord_name = ?, discord_avatar = ? WHERE id = ?').run(name, avatar, id);

  const idSchema = z.string().regex(/^\d{15,25}$/);
  const nameSchema = z.string().trim().min(1).max(100);
  const avatarSchema = z.string().max(64).regex(/^[a-z0-9_]+$/i).nullable().optional();

  app.post(
    '/internal/discord/register',
    internal,
    wrap((req, res) => {
      const b = z
        .object({ discordId: idSchema, displayName: nameSchema, avatarHash: avatarSchema, gameNick: z.string().max(200), agree: z.boolean().optional() })
        .safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: 'bad body' });
      const { discordId, displayName } = b.data;
      const avatar = b.data.avatarHash ?? null;
      const nick = cleanGameNick(b.data.gameNick);
      if (!allowAttempt(discordId)) {
        return res.status(429).json({ error: 'rate', message: 'Слишком много попыток регистрации. Повторите через час.' });
      }
      if (!nick) return res.status(400).json({ error: 'nick', message: 'Игровой ник: от 2 до 40 символов.' });

      const existing = byDiscord(discordId);
      if (existing) {
        if (nickOwner(nick, existing.id)) return res.json({ status: 'conflict', username: existing.username, profileUrl: profileUrl(), message: 'Этот игровой ник уже занят другим аккаунтом.' });
        setNick(existing.id, nick);
        refresh(existing.id, displayName, avatar);
        const pending = existing.status === 'pending';
        return res.json({
          status: pending ? 'pending' : 'exists',
          username: existing.username,
          profileUrl: profileUrl(),
          message: pending ? 'Ваша заявка ещё ожидает одобрения администратора. Игровой ник сохранён.' : 'Аккаунт уже есть: игровой ник и данные Discord обновлены.',
        });
      }

      if (!deps.registrationOpen()) return res.json({ status: 'disabled', username: '', profileUrl: profileUrl(), message: 'Регистрация закрыта администратором.' });
      const rules = deps.rulesText();
      if (rules && b.data.agree !== true) {
        return res.json({ status: 'rules', username: '', profileUrl: profileUrl(), rulesText: rules, message: 'Прочитайте правила и повторите команду с параметром agree:True.' });
      }
      if (nickOwner(nick, 0)) return res.json({ status: 'conflict', username: '', profileUrl: profileUrl(), message: 'Этот игровой ник уже занят другим аккаунтом.' });

      const base = sanitizeLogin(displayName, discordId);
      const login = uniqueLogin(base, (c) => !!db.prepare('SELECT 1 FROM users WHERE ulower(username) = ?').get(c.toLowerCase()));
      const pending = deps.registrationMode() === 'approval';
      const status = pending ? 'pending' : 'active';
      let id = 0;
      db.transaction(() => {
        id = Number(
          db
            .prepare("INSERT INTO users (username, password_hash, role, created_at, status, discord_id, discord_name, discord_avatar, no_password) VALUES (?, ?, 'player', ?, ?, ?, ?, ?, 1)")
            .run(login, bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 4), Date.now(), status, discordId, displayName, avatar).lastInsertRowid,
        );
        setNick(id, nick);
      })();
      logAccount(req, id, 'register_discord', pending ? 'ожидает одобрения' : '');
      res.json({
        status: pending ? 'pending' : 'created',
        username: login,
        profileUrl: profileUrl(),
        message: pending ? 'Заявка отправлена: дождитесь одобрения администратора.' : 'Аккаунт создан. Входите в панель кнопкой «Войти через Discord».',
      });
    }),
  );

  app.post(
    '/internal/discord/nick',
    internal,
    wrap((req, res) => {
      const b = z.object({ discordId: idSchema, gameNick: z.string().max(200), displayName: nameSchema.optional(), avatarHash: avatarSchema }).safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: 'bad body' });
      const nick = cleanGameNick(b.data.gameNick);
      if (!nick) return res.status(400).json({ error: 'nick', status: 'invalid' });
      const u = byDiscord(b.data.discordId);
      if (!u) return res.json({ status: 'notfound' });
      if (nickOwner(nick, u.id)) return res.json({ status: 'conflict' });
      setNick(u.id, nick);
      if (b.data.displayName) refresh(u.id, b.data.displayName, b.data.avatarHash ?? null);
      logAccount(req, u.id, 'profile_changed', 'ник из Discord');
      res.json({ status: 'ok', gameNick: nick });
    }),
  );

  app.get(
    '/internal/discord/profile',
    internal,
    wrap((req, res) => {
      const id = String(req.query.discordId ?? '');
      const u = idSchema.safeParse(id).success ? byDiscord(id) : undefined;
      if (!u) return res.json({ found: false, username: '', displayName: '', gameNick: '', rank: null, achievements: 0, profileUrl: profileUrl() });
      const name = String(req.query.displayName ?? '').trim().slice(0, 100);
      if (name) refresh(u.id, name, /^[a-z0-9_]{1,64}$/i.test(String(req.query.avatarHash ?? '')) ? String(req.query.avatarHash) : null);
      const p = db.prepare('SELECT game_nick FROM user_player WHERE user_id = ?').get(u.id) as { game_nick: string } | undefined;
      const gameNick = p?.game_nick ?? '';
      let rank: { name: string; hours: number } | null = null;
      if (gameNick) {
        const { hours } = vrHoursOf(u.id, gameNick);
        rank = { name: rankForHours(hours).name, hours: Math.round(hours * 10) / 10 };
      }
      const earned = achievementsOf(u.id).filter((a) => a.earned).length + vrAchievementsOf(u.id).filter((a) => a.earned).length;
      res.json({ found: true, status: u.status, username: u.username, displayName: name || u.discord_name || u.username, gameNick, rank, achievements: earned, profileUrl: profileUrl() });
    }),
  );
}
