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
import type { Express, Request, RequestHandler } from 'express';
import { z } from 'zod';
import { isRealDomain, needsSetup, publicBase, registrationMode, rulesText } from '../admin/site.js';
import { db } from '../db.js';
import { readScoped, writeScoped } from './gameNewsScope.js';
import { recordConsent } from '../monitoring/rules.js';
import { passwordError } from '../security/passwordPolicy.js';
import { registrationOpen } from '../security/auth.js';
import { pluginTarget } from './gameNews.js';
import { plainLine } from './gameNewsJoinLeave.js';
import { loginFromNick } from './gameNewsLogic.js';
import { rankLine } from './gameNewsRank.js';
import { vrHoursOf } from '../profile/profileVr.js';

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
  /** after .login: the game account is linked to an account of the panel: {login} {panel} */
  loginText: string;
  /** how often the Discord hint is repeated for the same player, hours */
  discordEveryHours: number;
  /** a registered player reads his rank at every join */
  rankEnabled: boolean;
  /** the rank line: {name} {rank} {hours} {next} */
  rankText: string;
}

export const DEFAULT_REGISTER: RegisterSettings = {
  enabled: false,
  promptText: '* Вы ещё не зарегистрированы в панели. Новый аккаунт: .register (пароль) (подтверждение). Уже есть аккаунт на сайте: .login (логин) (пароль)',
  doneText: '* Готово! Вы зарегистрированы в панели, ваш логин: {login}',
  discordText: '* Привяжите Discord в профиле панели ({panel}): аккаунт будет под рукой в Discord, а роли и ранг — на вашем сервере.',
  pendingText: '* Заявка на регистрацию отправлена. Когда администратор её одобрит, вы сможете войти в панель.',
  loginText: '* Готово! Игровой аккаунт привязан к аккаунту {login} в панели.',
  discordEveryHours: 24,
  rankEnabled: true,
  rankText: '* {name}, ваш ранг: {rank} · {hours} ч{next}',
};

/** the hint of the first version: a setting that still holds exactly it has not been changed by anybody */
const OLD_PROMPT = '* Вы ещё не зарегистрированы в панели. Для регистрации введите .register пароль подтверждение_пароля';

// the colours of the lines the player reads
const C_INFO = '#FFCC33';
const C_GOOD = '#5FD068';
const C_BAD = '#FF5555';
const C_HINT = '#6EC1FF';
/**
 * A line the player reads: in one colour, with the commands picked out: «.register» in white bold and the arguments after it,
 * «(пароль)», in lilac (like the usage line of the commands of the game). The tags are flat, so no client has to nest them.
 */
export function tag(color: string, text: string): string {
  const plain = plainLine(text);
  const parts: string[] = [];
  let last = 0;
  for (const m of plain.matchAll(/(^|\s)(\.[a-zа-я]+)((?:\s*\([^()]{1,40}\))*)/giu)) {
    const start = (m.index ?? 0) + m[1].length;
    if (start > last) parts.push(`<color=${color}>${plain.slice(last, start)}</color>`);
    parts.push(`<color=#FFFFFF><b>${m[2]}</b></color>`);
    if (m[3]) parts.push(`<color=#B9A7FF>${m[3]}</color>`);
    last = start + m[2].length + m[3].length;
  }
  if (last < plain.length) parts.push(`<color=${color}>${plain.slice(last)}</color>`);
  return parts.length ? parts.join('') : `<color=${color}></color>`;
}

export function getRegisterSettings(serverId?: number): RegisterSettings {
  try {
    const v = JSON.parse(readScoped('gamenews_register', serverId) || '{}') as Partial<RegisterSettings>;
    const d = DEFAULT_REGISTER;
    const text = (x: unknown, def: string) => (typeof x === 'string' && x.trim() ? x : def);
    return {
      enabled: !!v.enabled,
      // the first wording of the hint (before .login and the brackets) moves to the new one; a text the administrator changed stays
      promptText: v.promptText === OLD_PROMPT ? d.promptText : text(v.promptText, d.promptText),
      doneText: text(v.doneText, d.doneText),
      discordText: text(v.discordText, d.discordText),
      pendingText: text(v.pendingText, d.pendingText),
      loginText: text(v.loginText, d.loginText),
      discordEveryHours: Number.isFinite(v.discordEveryHours) ? Math.min(720, Math.max(1, Math.round(v.discordEveryHours as number))) : d.discordEveryHours,
      rankEnabled: typeof v.rankEnabled === 'boolean' ? v.rankEnabled : d.rankEnabled,
      rankText: text(v.rankText, d.rankText),
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

/**
 * The address of the panel as the player should type it: the address the game plugin itself reaches the panel at (its Host header: the
 * request carries the token of a server, so it is trusted), else the one the panel knows about itself.
 */
function panelUrl(req?: Request): string {
  const host = req ? String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim().split(':')[0] : '';
  if (isRealDomain(host)) return host;
  return (publicBase() ?? '').replace(/^https?:\/\//, '');
}

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
      return res.json({ registered: false, replies: [tag(C_INFO, fill(s.promptText, { panel: panelUrl(req) }))] });
    }
    const u = db.prepare('SELECT id, status, discord_id FROM users WHERE id = ?').get(who.user_id) as UserRow | undefined;
    const due = now - who.last_hint_at >= s.discordEveryHours * 3_600_000;
    const replies: string[] = [];
    if (u && u.status === 'active' && s.rankEnabled) {
      const nick = (db.prepare('SELECT game_nick FROM user_player WHERE user_id = ?').get(u.id) as { game_nick: string } | undefined)?.game_nick || (db.prepare('SELECT nick FROM game_identities WHERE platform_id = ?').get(id.data) as { nick: string } | undefined)?.nick || '';
      replies.push(tag(C_GOOD, rankLine(s.rankText, nick, vrHoursOf(u.id, nick).hours)));
    }
    if (u && u.status === 'active' && !u.discord_id && due) {
      db.prepare('UPDATE game_identities SET last_hint_at = ? WHERE platform_id = ?').run(now, id.data);
      replies.push(tag(C_HINT, fill(s.discordText, { panel: panelUrl(req) })));
    }
    res.json({ registered: true, replies });
  });

  // .register <password> <password again>
  app.post('/api/game-news/player/register', plugin, async (req, res) => {
    const b = z.object({ id: idSchema, name: z.string().max(100), password: z.string().min(1).max(256) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ replies: [tag(C_BAD, '* Не удалось разобрать команду. Введите: .register (пароль) (подтверждение)')] });
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

    const vars = { login, panel: panelUrl(req) };
    if (pending) return res.json({ ok: true, pending: true, login, replies: [tag(C_GOOD, fill(s.pendingText, vars))] });
    res.json({ ok: true, login, replies: [tag(C_GOOD, fill(s.doneText, vars)), tag(C_HINT, fill(s.discordText, vars))] });
  });

  // .login <login> <password>: the player already has an account in the panel; this game account is linked to it
  app.post('/api/game-news/player/login', plugin, async (req, res) => {
    const b = z.object({ id: idSchema, name: z.string().max(100), login: z.string().min(1).max(64), password: z.string().min(1).max(256) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ replies: [tag(C_BAD, '* Не удалось разобрать команду. Введите: .login (логин) (пароль)')] });
    const s = getRegisterSettings((req as typeof req & { gameServerId?: number }).gameServerId);
    const now = Date.now();
    const say = (color: string, text: string) => res.json({ ok: false, replies: [tag(color, text)] });
    if (!s.enabled) return say(C_BAD, '* Вход из игры отключён.');
    // a few tries an hour for one game account and for one login (somebody may try to guess a password of another person)
    if (tooMany(b.data.id, now) || tooMany(`login:${b.data.login.toLowerCase()}`, now)) return say(C_BAD, '* Слишком много попыток. Попробуйте позже.');
    if (needsSetup()) return say(C_BAD, '* Панель ещё не настроена.');

    const own = db.prepare('SELECT g.user_id, u.username FROM game_identities g JOIN users u ON u.id = g.user_id WHERE g.platform_id = ?').get(b.data.id) as { user_id: number; username: string } | undefined;
    if (own) return say(C_INFO, `* Этот игровой аккаунт уже привязан к аккаунту ${own.username}.`);

    const u = db.prepare('SELECT id, username, password_hash, status, banned_at, banned_until, totp_enabled FROM users WHERE ulower(username) = ?').get(b.data.login.toLowerCase()) as
      | { id: number; username: string; password_hash: string; status: string; banned_at: number | null; banned_until: number | null; totp_enabled: number }
      | undefined;
    // the same answer and the same work for a wrong login and a wrong password
    const ok = await bcrypt.compare(b.data.password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok) return say(C_BAD, '* Неверный логин или пароль.');
    if (u.status === 'pending') return say(C_INFO, '* Аккаунт ещё ждёт одобрения администратора.');
    if (u.status !== 'active') return say(C_BAD, '* Этот аккаунт сейчас недоступен.');
    if (u.banned_at && (!u.banned_until || u.banned_until > now)) return say(C_BAD, '* Этот аккаунт заблокирован.');
    // a second factor cannot be asked in the chat: the link is made in the panel instead
    if (u.totp_enabled) return say(C_INFO, `* На аккаунте включена двухфакторная защита: привяжите игру в профиле панели (${panelUrl(req)}).`);

    db.prepare('INSERT INTO game_identities (platform_id, user_id, nick, created_at, last_hint_at) VALUES (?, ?, ?, ?, ?)').run(b.data.id, u.id, b.data.name, now, now);
    // the nickname is linked to the account when the account has none yet and no other account holds this nickname
    const nick = plainLine(b.data.name).slice(0, 40);
    const has = db.prepare('SELECT game_nick FROM user_player WHERE user_id = ?').get(u.id) as { game_nick: string } | undefined;
    if (nick && !has?.game_nick && !db.prepare('SELECT 1 FROM user_player WHERE ulower(game_nick) = ulower(?)').get(nick)) {
      db.prepare("INSERT INTO user_player (user_id, game_nick, bio, public_profile) VALUES (?, ?, '', 0) ON CONFLICT(user_id) DO UPDATE SET game_nick = excluded.game_nick").run(u.id, nick);
    }
    db.prepare('INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)').run(now, 'game-plugin', 'game_login', u.username);
    res.json({ ok: true, login: u.username, replies: [tag(C_GOOD, fill(s.loginText, { login: u.username, panel: panelUrl(req) }))] });
  });
}

/** compared against when no such login exists, so that the time does not tell whether it does */
const DUMMY_HASH = bcrypt.hashSync('coregsm-no-such-user', 12);
