/**
 * Moderation from the game: .kick, .ban, .unban, .warn (and /kick of the Discord bot). An administrator of the game types a command;
 * the plugin asks the panel (POST /api/game-news/player/mod) and the panel decides: is it on, may this player be touched, is a reason
 * needed, is a pause in force, how the line for everybody reads, what the player is told in private, for how long a ban lasts. The plugin
 * then shows the lines and removes the player. Everything is set in the panel (Игроки → Команда .kick).
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { enqueueAlert } from '../alerts/alerts.js';
import { db } from '../db.js';
import { internal } from '../security/auth.js';
import { pluginTarget } from './gameNews.js';
import { postKickToDiscord } from './gameNewsChat.js';
import { isHexColor, plainLine } from './gameNewsJoinLeave.js';
import { tag, type Accent } from './gameNewsStyle.js';
import {
  activeBan, commandState, countMod, finishCommand, findBanByNick, formatSpan, listBans, logMod, parseBanTime, putBan, queueCommand, recentMod,
  removeBan, topPlayers, type BanRow,
} from './gameNewsModLog.js';
import { readScoped, serverOf, writeScoped } from './gameNewsScope.js';
import { serverLabel, visitStamp } from './gameNewsVars.js';

export interface KickReason { key: string; text: string }

export interface KickSettings {
  enabled: boolean;
  /** .ban and .unban are allowed (only when the commands as a whole are on) */
  banEnabled: boolean;
  /** .warn is allowed */
  warnEnabled: boolean;
  /** the line for everybody after a kick: {name} the player, {reason}, {admin} who did it */
  template: string;
  textColor: string;
  nameColor: string;
  reasonColor: string;
  adminColor: string;
  /** used when the administrator gave no reason */
  defaultReason: string;
  /** a command without a reason is refused */
  requireReason: boolean;
  /** administrators of the game cannot be touched with the commands */
  protectAdmins: boolean;
  /** the line is shown to everybody (off: the player is removed quietly) */
  announce: boolean;
  /** seconds between two kicks of one administrator (0 = no pause) */
  cooldownSec: number;
  /** the longest reason, characters */
  maxReason: number;
  /** the channel of Discord (the bot posts there) for the log: where, when, whom, who and why; '' = none */
  logChannelId: string;
  /** the line after a ban: {name} {reason} {admin} {time} (how long) */
  banTemplate: string;
  /** the line after a warning: {name} {reason} {admin} {n} (how many) {limit} */
  warnTemplate: string;
  /** the line after an unban: {name} {admin} (no reason is needed) */
  unbanTemplate: string;
  /** what a banned player reads when he tries to come in: {reason} {until} */
  banJoinText: string;
  /** what a player reads when he comes back too soon after a kick: {left} */
  blockJoinText: string;
  /** the player is told in private before he is removed */
  notifyPlayer: boolean;
  /** the private words to the player: {reason} {admin} */
  notifyText: string;
  /** the number of warnings that makes a kick (0 = warnings never kick) */
  warnLimit: number;
  /** warnings older than this many days are not counted */
  warnDays: number;
  /** minutes after a kick during which the player cannot come back (0 = he can) */
  rejoinBlockMin: number;
  /** short names for reasons: «.kick Ник 1» means the text of reason «1» */
  reasons: KickReason[];
}

export const DEFAULT_KICK: KickSettings = {
  enabled: true,
  banEnabled: true,
  warnEnabled: true,
  template: '* Игрок {name} был кикнут с сервера. Причина: {reason}',
  textColor: '#FF5555',
  nameColor: '#5FD068',
  reasonColor: '#FFCC33',
  adminColor: '#6EC1FF',
  defaultReason: 'не указана',
  requireReason: false,
  protectAdmins: true,
  announce: true,
  cooldownSec: 0,
  maxReason: 100,
  logChannelId: '',
  banTemplate: '* Игрок {name} был забанен на {time}. Причина: {reason}',
  warnTemplate: '* Игрок {name} был предупреждён. Причина: {reason}',
  unbanTemplate: '* Игрок {name} был разбанен.',
  banJoinText: '* Вы забанены {until}. Причина: {reason}',
  blockJoinText: '* Вы недавно были кикнуты. Подождите ещё {left}, прежде чем зайти.',
  notifyPlayer: true,
  notifyText: '* Вас убирают с сервера. Причина: {reason}',
  warnLimit: 3,
  warnDays: 30,
  rejoinBlockMin: 0,
  reasons: [
    { key: '1', text: 'Спам' },
    { key: '2', text: 'Оскорбления' },
    { key: '3', text: 'Читы или использование багов' },
    { key: '4', text: 'Мешает другим игрокам' },
  ],
};

export function getKick(serverId?: number): KickSettings {
  try {
    const v = JSON.parse(readScoped('gamenews_kick', serverId) || '{}') as Partial<KickSettings>;
    const d = DEFAULT_KICK;
    const text = (x: unknown, def: string) => (typeof x === 'string' && x.trim() ? x : def);
    const color = (x: unknown, def: string) => (isHexColor(x) ? (x as string).toUpperCase() : def);
    const bool = (x: unknown, def: boolean) => (typeof x === 'boolean' ? x : def);
    const num = (x: unknown, def: number, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : def);
    const reasons = Array.isArray(v.reasons)
      ? v.reasons.filter((r): r is KickReason => !!r && typeof r.key === 'string' && typeof r.text === 'string' && !!r.key.trim() && !!r.text.trim()).slice(0, 20).map((r) => ({ key: r.key.trim().slice(0, 12), text: r.text.trim().slice(0, 100) }))
      : d.reasons.map((r) => ({ ...r }));
    return {
      enabled: bool(v.enabled, d.enabled),
      banEnabled: bool(v.banEnabled, d.banEnabled),
      warnEnabled: bool(v.warnEnabled, d.warnEnabled),
      template: text(v.template, d.template),
      textColor: color(v.textColor, d.textColor),
      nameColor: color(v.nameColor, d.nameColor),
      reasonColor: color(v.reasonColor, d.reasonColor),
      adminColor: color(v.adminColor, d.adminColor),
      defaultReason: text(v.defaultReason, d.defaultReason),
      requireReason: bool(v.requireReason, d.requireReason),
      protectAdmins: bool(v.protectAdmins, d.protectAdmins),
      announce: bool(v.announce, d.announce),
      cooldownSec: num(v.cooldownSec, d.cooldownSec, 0, 3600),
      maxReason: num(v.maxReason, d.maxReason, 10, 200),
      logChannelId: typeof v.logChannelId === 'string' && /^\d{15,25}$/.test(v.logChannelId) ? v.logChannelId : d.logChannelId,
      banTemplate: text(v.banTemplate, d.banTemplate),
      warnTemplate: text(v.warnTemplate, d.warnTemplate),
      unbanTemplate: text(v.unbanTemplate, d.unbanTemplate),
      banJoinText: text(v.banJoinText, d.banJoinText),
      blockJoinText: text(v.blockJoinText, d.blockJoinText),
      notifyPlayer: bool(v.notifyPlayer, d.notifyPlayer),
      notifyText: text(v.notifyText, d.notifyText),
      warnLimit: num(v.warnLimit, d.warnLimit, 0, 20),
      warnDays: num(v.warnDays, d.warnDays, 1, 365),
      rejoinBlockMin: num(v.rejoinBlockMin, d.rejoinBlockMin, 0, 1440),
      reasons,
    };
  } catch {
    return { ...DEFAULT_KICK, reasons: DEFAULT_KICK.reasons.map((r) => ({ ...r })) };
  }
}

type LineVars = { name?: string; reason?: string; admin?: string; time?: string; n?: number; limit?: number };

/**
 * A line for everybody in flat colour tags: the text in its colour, the nickname, the reason and the administrator each in theirs.
 * What a player typed (a reason, a nickname) cannot bring tags of its own.
 */
export function modLine(s: KickSettings, template: string, v: LineVars): string {
  const vars: Record<string, { text: string; color: string }> = {
    name: { text: plainLine(v.name ?? ''), color: s.nameColor },
    reason: { text: plainLine(v.reason ?? ''), color: s.reasonColor },
    admin: { text: plainLine(v.admin ?? ''), color: s.adminColor },
    time: { text: plainLine(v.time ?? ''), color: s.reasonColor },
    n: { text: String(v.n ?? ''), color: s.reasonColor },
    limit: { text: String(v.limit ?? ''), color: s.reasonColor },
  };
  const out: string[] = [];
  for (const part of plainLine(template).split(/(\{(?:name|reason|admin|time|n|limit)\})/)) {
    if (!part) continue;
    const m = /^\{(name|reason|admin|time|n|limit)\}$/.exec(part);
    if (m) out.push(`<color=${vars[m[1]].color}>${vars[m[1]].text}</color>`);
    else out.push(`<color=${s.textColor}>${part}</color>`);
  }
  return out.join('');
}

export const kickLine = (s: KickSettings, name: string, reason: string, admin: string): string => modLine(s, s.template, { name, reason, admin });

/** a private line: the words in one colour, the reason in yellow, the variables filled in (no tags from outside) */
const privateLine = (s: KickSettings, template: string, v: LineVars): string => modLine({ ...s, nameColor: s.textColor, adminColor: s.textColor, reasonColor: '#FFCC33' }, template, v);

/** a short name for a reason («1») becomes its text; anything else stays as typed */
export function expandReason(s: KickSettings, raw: string): string {
  const r = raw.trim();
  const hit = s.reasons.find((x) => x.key.toLowerCase() === r.toLowerCase());
  return hit ? hit.text : r;
}

// ---- a pause between two kicks of one administrator
const last = new Map<string, number>();
export function kickWait(adminId: string, cooldownSec: number, now: number): number {
  if (cooldownSec <= 0) return 0;
  const left = Math.ceil(((last.get(adminId) ?? 0) + cooldownSec * 1000 - now) / 1000);
  return left > 0 ? left : 0;
}
export function kickDone(adminId: string, now: number): void {
  last.set(adminId, now);
  if (last.size > 300) for (const [k, t] of last) if (now - t > 3_600_000) last.delete(k);
}

const C_BAD = '#FF5555';
const C_GOOD = '#5FD068';
/** a line for the administrator: the commands picked out, the nickname (and what else is given) in bold */
const say = (color: string, text: string, names: Accent[] = []): string => tag(color, text, names);

export interface ModInput {
  action: 'kick' | 'ban' | 'warn';
  adminId: string;
  adminName: string;
  targetId: string;
  name: string;
  targetIsAdmin: boolean;
  reason: string;
  /** a ban: «7d», «2h», «перм» */
  time?: string;
}

export interface ModResult {
  ok: boolean;
  /** the line for everybody ('' = none) */
  line: string;
  /** the private words to the player before he is removed ('' = none) */
  notice: string;
  /** the plugin removes the player */
  kick: boolean;
  replies: string[];
}

const refuse = (text: string, names: Accent[] = []): ModResult => ({ ok: false, line: '', notice: '', kick: false, replies: [say(C_BAD, text, names)] });

/** what is told in the log channel of the administrators */
function logToDiscord(s: KickSettings, serverId: number, title: string, color: number, f: { name: string; admin: string; reason: string; extra?: { name: string; value: string }[] }, now: number): void {
  if (!s.logChannelId) return;
  try {
    const unix = Math.floor(now / 1000);
    enqueueAlert('update', serverLabel(serverId), {
      content: '', mention: 'none',
      embed: {
        title,
        color,
        fields: [
          { name: 'Сервер', value: serverLabel(serverId).slice(0, 200) || '—', inline: true },
          { name: 'Игрок', value: plainLine(f.name).slice(0, 100) || '—', inline: true },
          { name: 'Кто', value: plainLine(f.admin).slice(0, 100) || '—', inline: true },
          ...(f.extra ?? []),
          { name: 'Причина', value: f.reason || '—' },
          { name: 'Когда', value: `<t:${unix}:f> (<t:${unix}:R>)` },
        ],
        timestamp: new Date(now).toISOString(),
      },
    }, s.logChannelId);
  } catch { /* the log must not stop the command */ }
}

/** the whole decision about a command of an administrator (kick, ban, warning); pure apart from the database and the chat in Discord */
export function runMod(serverId: number, b: ModInput, now = Date.now()): ModResult {
  const s = getKick(serverId);
  const word = b.action === 'kick' ? '.kick' : b.action === 'ban' ? '.ban' : '.warn';
  if (!s.enabled || (b.action === 'ban' && !s.banEnabled) || (b.action === 'warn' && !s.warnEnabled)) return refuse(`* Команда ${word} отключена в панели.`);
  if (s.protectAdmins && b.targetIsAdmin) return refuse('* Администратора трогать нельзя.');

  if (b.action === 'kick') {
    const wait = kickWait(b.adminId, s.cooldownSec, now);
    if (wait > 0) return refuse(`* Подождите ещё ${wait} с перед следующим киком.`);
  }
  let reason = plainLine(expandReason(s, b.reason)).slice(0, s.maxReason);
  if (!reason) {
    if (s.requireReason) return refuse(`* Укажите причину: ${word} (ник) ${b.action === 'ban' ? '(срок) ' : ''}(причина)`);
    reason = plainLine(s.defaultReason).slice(0, s.maxReason);
  }
  const base = { platformId: b.targetId, nick: plainLine(b.name), admin: plainLine(b.adminName), reason, serverId };
  const notice = (template: string, extra: LineVars = {}): string => (s.notifyPlayer ? privateLine(s, template, { reason, admin: b.adminName, ...extra }) : '');

  if (b.action === 'kick') {
    kickDone(b.adminId, now);
    logMod({ ...base, kind: 'kick' }, now);
    // a short block against coming straight back
    if (s.rejoinBlockMin > 0 && b.targetId && b.targetId !== '0') {
      putBan({ platformId: b.targetId, nick: base.nick, reason, admin: base.admin, until: now + s.rejoinBlockMin * 60_000, kind: 'block', serverId }, now);
    }
    try { postKickToDiscord(serverId, s.template, { name: b.name, reason, admin: b.adminName }, now); } catch { /* Discord is not needed for the kick */ }
    logToDiscord(s, serverId, '🚪 Игрок кикнут', 0xed4245, { name: b.name, admin: b.adminName, reason }, now);
    return {
      ok: true, kick: true,
      line: s.announce ? kickLine(s, b.name, reason, b.adminName) : '',
      notice: notice(s.notifyText),
      replies: [say(C_GOOD, `* Игрок ${b.name} кикнут.${s.announce ? '' : ' (без объявления)'}`, [b.name])],
    };
  }

  if (b.action === 'ban') {
    const t = parseBanTime(b.time ?? '');
    if ('error' in t) return refuse(t.error === 'format' ? '* Укажите срок: .ban (ник) (срок) (причина). Срок: 30m, 2h, 7d, 2w или «перм».' : t.error === 'short' ? '* Срок бана не меньше минуты.' : '* Срок бана не больше года: для вечного бана напишите «перм».');
    const forever = 'forever' in t;
    const until = forever ? 0 : now + t.seconds * 1000;
    const span = forever ? 'навсегда' : formatSpan(t.seconds);
    if (b.targetId && b.targetId !== '0') putBan({ platformId: b.targetId, nick: base.nick, reason, admin: base.admin, until, kind: 'ban', serverId }, now);
    logMod({ ...base, kind: 'ban', until }, now);
    try { postKickToDiscord(serverId, s.banTemplate.replace(/\{time\}/g, span), { name: b.name, reason, admin: b.adminName }, now); } catch { /* Discord is not needed for the ban */ }
    logToDiscord(s, serverId, '⛔ Игрок забанен', 0x992d22, { name: b.name, admin: b.adminName, reason, extra: [{ name: 'Срок', value: forever ? 'навсегда' : `${span} (до <t:${Math.floor(until / 1000)}:f>)` }] }, now);
    const stamp = forever ? null : visitStamp(until);
    return {
      ok: true, kick: true,
      line: s.announce ? modLine(s, s.banTemplate, { name: b.name, reason, admin: b.adminName, time: span }) : '',
      notice: notice(s.banJoinText.replace(/\{until\}/g, stamp ? `до ${stamp.date} в ${stamp.time}` : 'навсегда')),
      replies: [say(C_GOOD, `* Игрок ${b.name} забанен ${forever ? 'навсегда' : `на ${span}`}.`, [b.name, ...(forever ? [] : [[span, '#FFFFFF'] as Accent])])],
    };
  }

  // a warning; the one that reaches the limit is a kick
  logMod({ ...base, kind: 'warn' }, now);
  const since = now - s.warnDays * 86_400_000;
  const n = b.targetId && b.targetId !== '0' ? countMod(b.targetId, 'warn', since) : 1;
  const escalate = s.warnLimit > 0 && n >= s.warnLimit;
  try { postKickToDiscord(serverId, s.warnTemplate.replace(/\{n\}/g, String(n)).replace(/\{limit\}/g, String(s.warnLimit)), { name: b.name, reason, admin: b.adminName }, now); } catch { /* Discord is not needed for the warning */ }
  logToDiscord(s, serverId, '⚠️ Предупреждение игроку', 0xf5b01e, { name: b.name, admin: b.adminName, reason, extra: [{ name: 'Предупреждений', value: `${n}${s.warnLimit ? ` из ${s.warnLimit}` : ''}` }] }, now);
  const warnLine = s.announce ? modLine(s, s.warnTemplate, { name: b.name, reason, admin: b.adminName, n, limit: s.warnLimit }) : '';
  if (!escalate) {
    return {
      ok: true, kick: false, line: warnLine,
      notice: notice('* Вам вынесено предупреждение ({n} из {limit}). Причина: {reason}', { n, limit: s.warnLimit }),
      replies: [say(C_GOOD, `* Игроку ${b.name} вынесено предупреждение (${n}${s.warnLimit ? ` из ${s.warnLimit}` : ''}).`, [b.name])],
    };
  }
  // the limit is reached: the player is kicked and the count starts again
  const kickReason = `лимит предупреждений (${n} из ${s.warnLimit})`;
  logMod({ ...base, kind: 'kick', reason: kickReason, admin: 'авто' }, now);
  try { postKickToDiscord(serverId, s.template, { name: b.name, reason: kickReason, admin: b.adminName }, now); } catch { /* Discord is not needed for the kick */ }
  logToDiscord(s, serverId, '🚪 Игрок кикнут (лимит предупреждений)', 0xed4245, { name: b.name, admin: 'авто', reason: kickReason }, now);
  db.prepare("DELETE FROM game_mod_log WHERE platform_id = ? AND kind = 'warn'").run(b.targetId);
  return {
    ok: true, kick: true,
    line: warnLine,
    notice: notice(s.notifyText, { reason: kickReason }),
    replies: [say(C_GOOD, `* Игроку ${b.name} вынесено предупреждение (${n} из ${s.warnLimit}): лимит достигнут, игрок кикнут.`, [b.name])],
  };
}

/** what a banned (or blocked) player reads when he comes in; null when nothing stops him */
export function joinBlock(serverId: number, platformId: string, now = Date.now()): { lines: string[]; ban: BanRow } | null {
  const ban = activeBan(platformId, now);
  if (!ban) return null;
  const s = getKick(serverId);
  if (ban.kind === 'block') {
    const left = formatSpan(Math.ceil((ban.until - now) / 1000));
    return { ban, lines: [privateLine(s, s.blockJoinText.replace(/\{left\}/g, left), { reason: ban.reason })] };
  }
  const stamp = ban.until === 0 ? null : visitStamp(ban.until);
  const until = stamp ? `до ${stamp.date} в ${stamp.time}` : 'навсегда';
  return { ban, lines: [privateLine(s, s.banJoinText.replace(/\{until\}/g, until), { reason: ban.reason })] };
}

const mask = (id: string): string => (id.length > 7 ? `${id.slice(0, 4)}…${id.slice(-3)}` : id);

export function registerGameNewsKick({ app, admin }: { app: Express; admin: RequestHandler }): void {
  const schema = z.object({
    adminId: z.string().max(25), adminName: z.string().max(100), targetId: z.string().max(25), name: z.string().max(100),
    targetIsAdmin: z.boolean(), reason: z.string().max(400), time: z.string().max(40).optional(),
  });
  const handle = (action: ModInput['action']): RequestHandler => (req, res) => {
    const t = pluginTarget(req);
    if (!t) return void res.status(401).json({ error: 'unauthorized' });
    const b = schema.safeParse(req.body);
    if (!b.success) return void res.status(400).json({ ok: false, replies: [say(C_BAD, '* Не удалось разобрать команду.')] });
    res.json(runMod(t.server_id, { ...b.data, action }));
  };
  // the plugin: .kick (the first versions), and .kick / .ban / .warn in one place
  app.post('/api/game-news/player/kick', handle('kick'));
  app.post('/api/game-news/player/mod', (req, res, next) => {
    const a = z.object({ action: z.enum(['kick', 'ban', 'warn']) }).safeParse(req.body);
    if (!a.success) return void res.status(400).json({ ok: false, replies: [say(C_BAD, '* Не удалось разобрать команду.')] });
    return handle(a.data.action)(req, res, next);
  });

  // .unban (ник): a banned player is let back
  app.post('/api/game-news/player/unban', (req, res) => {
    const t = pluginTarget(req);
    if (!t) return res.status(401).json({ error: 'unauthorized' });
    const b = z.object({ adminName: z.string().max(100), name: z.string().max(100) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ ok: false, replies: [say(C_BAD, '* Введите: .unban (ник)')] });
    const s = getKick(t.server_id);
    if (!s.enabled || !s.banEnabled) return res.json(refuse('* Команда .unban отключена в панели.'));
    const ban = findBanByNick(b.data.name);
    if (!ban) return res.json(refuse(`* Бан для «${plainLine(b.data.name)}» не найден.`, [b.data.name]));
    removeBan(ban.platform_id);
    const now = Date.now();
    logMod({ kind: 'unban', platformId: ban.platform_id, nick: ban.nick, admin: plainLine(b.data.adminName), reason: '', serverId: t.server_id }, now);
    logToDiscord(s, t.server_id, '✅ Игрок разбанен', 0x2ecc71, { name: ban.nick, admin: b.data.adminName, reason: ban.reason }, now);
    // the same colours as a kick: «* Игрок Ник был разбанен.» for everybody and in the chat in Discord (no reason is needed)
    try { postKickToDiscord(t.server_id, s.unbanTemplate, { name: ban.nick, reason: '', admin: b.data.adminName }, now); } catch { /* Discord is not needed for the unban */ }
    res.json({ ok: true, line: s.announce ? modLine(s, s.unbanTemplate, { name: ban.nick, reason: '', admin: b.data.adminName }) : '', notice: '', kick: false, replies: [say(C_GOOD, `* ${ban.nick} разбанен.`, [ban.nick])] });
  });

  // the plugin: the commands that it has to do (a kick from Discord) come in the answer to a poll; this is how it reports
  app.post('/api/game-news/command-result', (req, res) => {
    const t = pluginTarget(req);
    if (!t) return res.status(401).json({ error: 'unauthorized' });
    const b = z.object({ id: z.number().int().positive(), ok: z.boolean(), text: z.string().max(300) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad' });
    finishCommand(t.server_id, b.data.id, b.data.ok, b.data.text);
    res.json({ ok: true });
  });

  // the bot: /kick (the same rights as /say and /restart)
  app.post('/internal/game-kick', internal, (req, res) => {
    const b = z.object({
      name: z.string().min(1).max(100), reason: z.string().max(400).optional(), server: z.string().max(100).optional(),
      discordId: z.string().max(32), discordAdmin: z.boolean(), adminName: z.string().max(80),
    }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ ok: false, text: 'Проверьте поля' });
    const linked = db.prepare("SELECT username FROM users WHERE discord_id = ? AND role = 'admin' AND status = 'active'").get(b.data.discordId) as { username: string } | undefined;
    if (!b.data.discordAdmin && !linked) return res.json({ ok: false, text: 'Эта команда только для администраторов.' });
    const all = (db.prepare("SELECT server_id FROM game_news_targets WHERE token_hash <> ''").all() as { server_id: number }[]).map((r) => ({ id: r.server_id, name: serverLabel(r.server_id) }));
    const q = (b.data.server ?? '').trim().toLowerCase();
    const found = q ? all.filter((s) => s.name.toLowerCase().includes(q)) : all;
    if (found.length === 0) return res.json({ ok: false, text: q ? 'Сервер не найден среди серверов с плагином.' : 'Нет серверов с плагином CoreGSM.' });
    const who = plainLine(linked?.username ?? b.data.adminName) || 'Discord';
    const now = Date.now();
    const ids = found.map((s) => queueCommand(s.id, 'kick', { name: plainLine(b.data.name), reason: plainLine(b.data.reason ?? ''), admin: `Discord: ${who}` }, now));
    res.json({ ok: true, ids, text: 'Команда отправлена на сервер.' });
  });

  app.get('/internal/game-command-status', internal, (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 20);
    const rows = ids.map((id) => commandState(id)).filter((r): r is NonNullable<typeof r> => !!r);
    const done = rows.find((r) => r.state === 'done');
    const finished = rows.length > 0 && rows.every((r) => r.state === 'done' || r.state === 'failed');
    res.json({ done: !!done, failed: finished && !done, text: done?.result ?? rows.find((r) => r.state === 'failed')?.result ?? '' });
  });

  // ---- the panel
  app.get('/api/game-news/moderation', admin, (req, res) => {
    const now = Date.now();
    res.json({
      bans: listBans(now).map((r) => ({ platformId: r.platform_id, masked: mask(r.platform_id), nick: r.nick, reason: r.reason, admin: r.admin, createdAt: r.created_at, until: r.until, kind: r.kind, serverName: r.server_id ? serverLabel(r.server_id) : '' })),
      log: recentMod({ player: String(req.query.player ?? ''), kind: String(req.query.kind ?? ''), limit: Number(req.query.limit) || 100 }).map((e) => ({
        id: e.id, ts: e.ts, kind: e.kind, nick: e.nick, platformId: e.platform_id, admin: e.admin, reason: e.reason, serverName: e.server_id ? serverLabel(e.server_id) : '', until: e.until,
      })),
      top: topPlayers(),
    });
  });

  // «Разбанить» in the panel
  app.delete('/api/game-news/bans/:platformId', admin, (req, res) => {
    const id = String(req.params.platformId);
    if (!/^\d{3,25}$/.test(id)) return res.status(400).json({ error: 'Проверьте поля' });
    const ban = removeBan(id);
    if (!ban) return res.status(404).json({ error: 'Бан не найден' });
    logMod({ kind: 'unban', platformId: id, nick: ban.nick, admin: (req as typeof req & { user?: { username?: string } }).user?.username ?? 'панель', reason: '', serverId: ban.server_id }, Date.now());
    res.json({ ok: true });
  });

  // the settings of the commands
  app.put('/api/game-news/kick-settings', admin, (req, res) => {
    const color = z.string().refine(isHexColor, 'color');
    const line = z.string().min(1).max(300);
    const b = z.object({
      enabled: z.boolean(), banEnabled: z.boolean().optional(), warnEnabled: z.boolean().optional(), template: line, textColor: color, nameColor: color, reasonColor: color, adminColor: color,
      defaultReason: z.string().max(100), requireReason: z.boolean(), protectAdmins: z.boolean(), announce: z.boolean(),
      cooldownSec: z.number().int().min(0).max(3600), logChannelId: z.string().regex(/^(\d{15,25})?$/), maxReason: z.number().int().min(10).max(200),
      banTemplate: line, warnTemplate: line, unbanTemplate: line, banJoinText: line, blockJoinText: line, notifyPlayer: z.boolean(), notifyText: line,
      warnLimit: z.number().int().min(0).max(20), warnDays: z.number().int().min(1).max(365), rejoinBlockMin: z.number().int().min(0).max(1440),
      reasons: z.array(z.object({ key: z.string().max(12), text: z.string().max(100) })).max(20),
    }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    const d = getKick(serverOf(req));
    const clean = (x: string, def: string) => plainLine(x) || def;
    const keys = new Set<string>();
    const reasons = b.data.reasons
      .map((r) => ({ key: plainLine(r.key).replace(/\s+/g, ''), text: plainLine(r.text) }))
      .filter((r) => r.key && r.text && !keys.has(r.key.toLowerCase()) && keys.add(r.key.toLowerCase()));
    writeScoped('gamenews_kick', JSON.stringify({
      ...b.data,
      banEnabled: b.data.banEnabled ?? d.banEnabled, warnEnabled: b.data.warnEnabled ?? d.warnEnabled,
      template: clean(b.data.template, d.template), banTemplate: clean(b.data.banTemplate, d.banTemplate), warnTemplate: clean(b.data.warnTemplate, d.warnTemplate), unbanTemplate: clean(b.data.unbanTemplate, d.unbanTemplate),
      banJoinText: clean(b.data.banJoinText, d.banJoinText), blockJoinText: clean(b.data.blockJoinText, d.blockJoinText), notifyText: clean(b.data.notifyText, d.notifyText),
      defaultReason: clean(b.data.defaultReason, d.defaultReason), reasons,
      textColor: b.data.textColor.toUpperCase(), nameColor: b.data.nameColor.toUpperCase(), reasonColor: b.data.reasonColor.toUpperCase(), adminColor: b.data.adminColor.toUpperCase(),
    }), serverOf(req));
    res.json({ ok: true });
  });
}
