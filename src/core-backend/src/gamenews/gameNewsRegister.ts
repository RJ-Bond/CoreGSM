/**
 * Registration in the panel from inside the game.
 *
 *  - A player joins: the plugin asks  GET /api/game-news/player/status  (who the player is: the platform id of the game
 *    account). A player who has no account is told how to register; a registered one without Discord gets a hint now and
 *    then. Everything the player reads comes from here (texts are set in the panel), the plugin only shows it.
 *  - The player types  .register <password> <password again>  and the plugin calls  POST /api/game-news/player/register.
 *    The panel creates the account (the login is the game nickname, with a number added when it is taken), links it to the
 *    nickname and to the platform id, and answers with the lines to show.
 *
 * The rules of the panel stay in force: a closed registration stays closed, a registration by request becomes a request,
 * the password policy is the same as on the site, registering counts as agreeing with the community rules. The password
 * is never logged and never stored in clear text.
 */
import bcrypt from 'bcryptjs';
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { needsSetup, publicBase, registrationMode, rulesText } from '../admin/site.js';
import { db } from '../db.js';
import { readScoped, writeScoped } from './gameNewsScope.js';
import { recordConsent } from '../monitoring/rules.js';
import { passwordError } from '../security/passwordPolicy.js';
import { registrationOpen } from '../security/auth.js';
import { pluginTarget } from './gameNews.js';
import { plainLine } from './gameNewsJoinLeave.js';
import { loginFromNick } from './gameNewsLogic.js';

export interface RegisterSettings {
  enabled: boolean;
  /** shown to a player without an account at every join */
  promptText: string;
  /** after a successful registration: {login} {panel} */
  doneText: string;
  /** the Discord hint: {panel} */
  discordText: string;
  /** registration by request: the request is sent */
  pendingText: string;
  /** how often the Discord hint is repeated for the same player, hours */
  discordEveryHours: number;
}

export const DEFAULT_REGISTER: RegisterSettings = {
  enabled: false,
  promptText: '* Вы ещё не зарегистрированы в панели. Для регистрации введите .register пароль подтверждение_пароля',
  doneText: '* Готово! Вы зарегистрированы в панели, ваш логин: {login}',
  discordText: '* Привяжите Discord в профиле панели ({panel}), чтобы управлять аккаунтом через Discord.',
  pendingText: '* Заявка на регистрацию отправлена. Когда администратор её одобрит, вы сможете войти в панель.',
  discordEveryHours: 24,
};

// the colours of the lines the player reads
const C_INFO = '#FFCC33';
const C_GOOD = '#5FD068';
const C_BAD = '#FF5555';
const C_HINT = '#6EC1FF';
const tag = (color: string, text: string): string => `<color=${color}>${plainLine(text)}</color>`;

export function getRegisterSettings(serverId?: number): RegisterSettings {
  try {
    const v = JSON.parse(readScoped('gamenews_register', serverId) || '{}') as Partial<RegisterSettings>;
    const d = DEFAULT_REGISTER;
    const text = (x: unknown, def: string) => (typeof x === 'string' && x.trim() ? x : def);
    return {
      enabled: !!v.enabled,
      promptText: text(v.promptText, d.promptText),
      doneText: text(v.doneText, d.doneText),
      discordText: text(v.discordText, d.discordText),
      pendingText: text(v.pendingText, d.pendingText),
      discordEveryHours: Number.isFinite(v.discordEveryHours) ? Math.min(720, Math.max(1, Math.round(v.discordEveryHours as number))) : d.discordEveryHours,
    };
  } catch {
    return { ...DEFAULT_REGISTER };
  }
}

export function setRegisterSettings(v: RegisterSettings, serverId?: number): void {
  writeScoped('gamenews_register', JSON.stringify(v), serverId);
}

const fill = (text: string, vars: { login?: string; panel: string }): string =>
  text.replace(/\{login\}/g, vars.login ?? '').replace(/\{panel\}/g, vars.panel);

const panelUrl = (): string => (publicBase() ?? '').replace(/^https?:\/\//, '');

// ---- brute force: a few tries an hour for one game account
const tries = new Map<string, { n: number; reset: number }>();
function tooMany(id: string, now: number): boolean {
  const e = tries.get(id);
  if (!e || e.reset < now) { tries.set(id, { n: 1, reset: now + 3_600_000 }); return false; }
  e.n++;
  return e.n > 8;
}

interface IdentityRow { platform_id: string; user_id: number; last_hint_at: number }
interface UserRow { id: number; status: string; discord_id: string | null }

const idSchema = z.string().regex(/^\d{5,25}$/);

export function registerGameNewsPlayers({ app }: { app: Express }): void {
  const plugin: RequestHandler = (req, res, next) => {
    const t = pluginTarget(req);
    if (!t) return res.status(401).json({ error: 'unauthorized' });
    (req as typeof req & { gameServerId?: number }).gameServerId = t.server_id;
    next();
  };

  // who is this player: what should they read now
  app.get('/api/game-news/player/status', plugin, (req, res) => {
    const s = getRegisterSettings((req as typeof req & { gameServerId?: number }).gameServerId);
    const id = idSchema.safeParse(String(req.query.id ?? ''));
    if (!s.enabled || !id.success) return res.json({ registered: false, replies: [] });
    const now = Date.now();
    const who = db.prepare('SELECT * FROM game_identities WHERE platform_id = ?').get(id.data) as IdentityRow | undefined;
    if (!who) {
      // nobody can register while the panel is closed or not set up: no use to invite
      if (needsSetup() || !registrationOpen()) return res.json({ registered: false, replies: [] });
      return res.json({ registered: false, replies: [tag(C_INFO, fill(s.promptText, { panel: panelUrl() }))] });
    }
    const u = db.prepare('SELECT id, status, discord_id FROM users WHERE id = ?').get(who.user_id) as UserRow | undefined;
    const due = now - who.last_hint_at >= s.discordEveryHours * 3_600_000;
    if (u && u.status === 'active' && !u.discord_id && due) {
      db.prepare('UPDATE game_identities SET last_hint_at = ? WHERE platform_id = ?').run(now, id.data);
      return res.json({ registered: true, replies: [tag(C_HINT, fill(s.discordText, { panel: panelUrl() }))] });
    }
    res.json({ registered: true, replies: [] });
  });

  // .register <password> <password again>
  app.post('/api/game-news/player/register', plugin, async (req, res) => {
    const b = z.object({ id: idSchema, name: z.string().max(100), password: z.string().min(1).max(256) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ replies: [tag(C_BAD, '* Не удалось разобрать команду. Введите: .register пароль подтверждение_пароля')] });
    const s = getRegisterSettings((req as typeof req & { gameServerId?: number }).gameServerId);
    const now = Date.now();
    const say = (color: string, text: string) => res.json({ ok: false, replies: [tag(color, text)] });
    if (!s.enabled) return say(C_BAD, '* Регистрация из игры отключена.');
    if (tooMany(b.data.id, now)) return say(C_BAD, '* Слишком много попыток. Попробуйте позже.');
    if (needsSetup() || !registrationOpen()) return say(C_BAD, '* Регистрация в панели сейчас закрыта.');
    if (db.prepare('SELECT 1 FROM game_identities WHERE platform_id = ?').get(b.data.id)) return say(C_INFO, '* Вы уже зарегистрированы в панели.');

    const taken = (login: string) => !!db.prepare('SELECT 1 FROM users WHERE ulower(username) = ?').get(login.toLowerCase());
    const login = loginFromNick(b.data.name, b.data.id, taken);
    // the same password policy as on the site
    const weak = b.data.password.length < 8 ? 'Пароль должен быть не короче 8 символов' : passwordError(b.data.password, { username: login, role: 'player' });
    if (weak) return say(C_BAD, `* ${weak}`);

    const hash = await bcrypt.hash(b.data.password, 12);
    const pending = registrationMode() === 'approval';
    let userId: number;
    try {
      userId = Number(db.prepare("INSERT INTO users (username, password_hash, role, created_at, status) VALUES (?, ?, 'player', ?, ?)").run(login, hash, now, pending ? 'pending' : 'active').lastInsertRowid);
    } catch {
      return say(C_BAD, '* Не удалось создать аккаунт: логин занят. Попробуйте ещё раз.');
    }
    if (rulesText()) recordConsent(userId, 'game'); // registering counts as agreeing with the rules
    db.prepare('INSERT INTO game_identities (platform_id, user_id, nick, created_at, last_hint_at) VALUES (?, ?, ?, ?, ?)').run(b.data.id, userId, b.data.name, now, now);
    // the nickname is linked to the account unless another account has taken it already
    const nick = plainLine(b.data.name).slice(0, 40);
    if (nick && !db.prepare('SELECT 1 FROM user_player WHERE ulower(game_nick) = ulower(?)').get(nick)) {
      db.prepare("INSERT INTO user_player (user_id, game_nick, bio, public_profile) VALUES (?, ?, '', 0) ON CONFLICT(user_id) DO NOTHING").run(userId, nick);
    }
    db.prepare('INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)').run(now, 'game-plugin', 'game_register', login);

    const vars = { login, panel: panelUrl() };
    if (pending) return res.json({ ok: true, pending: true, login, replies: [tag(C_GOOD, fill(s.pendingText, vars))] });
    res.json({ ok: true, login, replies: [tag(C_GOOD, fill(s.doneText, vars)), tag(C_HINT, fill(s.discordText, vars))] });
  });
}
