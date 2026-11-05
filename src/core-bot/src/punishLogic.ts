/** /ban, /unban, /kick, /warn: pure logic (checks of who may act on whom, texts, the waiting confirmations). No discord.js import. */

export type PunishAction = 'ban' | 'unban' | 'kick' | 'warn' | 'timeout' | 'unmute';

export const MAX_REASON = 400;
/** a confirmation of a ban or a kick lives this long */
export const PUNISH_TTL_MS = 2 * 60_000;
/** history of messages that a ban may delete, in days (Discord allows 0..7) */
export const DELETE_DAYS = [0, 1, 7] as const;

/** the reason as the moderator typed it: trimmed, line breaks tamed, cut to the limit */
export function cleanReason(s: unknown): string {
  return (typeof s === 'string' ? s : '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_REASON);
}

/** the days of messages to delete with a ban: one of the allowed values, anything else is 0 */
export const deleteDays = (v: unknown): number => ((DELETE_DAYS as readonly number[]).includes(v as number) ? (v as number) : 0);
export const deleteSeconds = (days: number): number => deleteDays(days) * 86_400;

export interface Standing {
  targetId: string;
  modId: string;
  botId: string;
  ownerId: string;
  /** the member is on the server (a ban may also hit a person who has left) */
  inGuild: boolean;
  /** position of the highest role of the target, the moderator and the bot */
  targetPos: number;
  modPos: number;
  botPos: number;
}

/** why this person cannot be punished by this moderator (a text for the moderator), or null when it is allowed */
export function standingProblem(s: Standing): string | null {
  if (s.targetId === s.modId) return 'Нельзя применить команду к самому себе.';
  if (s.targetId === s.botId) return 'Нельзя применить команду к боту.';
  if (s.targetId === s.ownerId) return 'Это владелец сервера: его нельзя наказать.';
  if (!s.inGuild) return null;
  if (s.targetPos >= s.botPos) return 'Высшая роль участника не ниже роли бота. Поднимите роль бота выше в настройках сервера.';
  if (s.modId !== s.ownerId && s.targetPos >= s.modPos) return 'Высшая роль участника не ниже вашей.';
  return null;
}

export const META: Record<PunishAction, { emoji: string; title: string; color: number; done: string }> = {
  ban: { emoji: '🔨', title: 'Бан', color: 0xe74c3c, done: 'заблокирован' },
  unban: { emoji: '🔓', title: 'Разбан', color: 0x2ecc71, done: 'разблокирован' },
  kick: { emoji: '👢', title: 'Кик', color: 0xe67e22, done: 'исключён с сервера' },
  warn: { emoji: '⚠️', title: 'Предупреждение', color: 0xf5b01e, done: 'получил предупреждение' },
  timeout: { emoji: '🔇', title: 'Мут', color: 0x7f8c8d, done: 'не может писать и говорить' },
  unmute: { emoji: '🔊', title: 'Размут', color: 0x2ecc71, done: 'снова может писать и говорить' },
};

export interface DmOpts {
  warnNo?: number;
  /** how many warnings fill the scale */
  scale?: number;
  /** when the warning stops counting (ms) */
  expiresAt?: number | null;
  /** the length of a timeout */
  minutes?: number;
}

/** what the person is told in a private message */
export function dmText(action: PunishAction, guild: string, o: DmOpts = {}): { title: string; text: string } {
  switch (action) {
    case 'ban': return { title: '🔨 Вы заблокированы', text: `Администрация сервера **${guild}** заблокировала вас. Если считаете это ошибкой, подайте апелляцию кнопкой ниже.` };
    case 'kick': return { title: '👢 Вас исключили с сервера', text: `Вас исключили с сервера **${guild}**. Вернуться можно по новому приглашению, если правила для вас понятны.` };
    case 'unban': return { title: '🔓 Вы разблокированы', text: `Блокировка на сервере **${guild}** снята. Вы можете вернуться по приглашению.` };
    case 'timeout': return { title: '🔇 Вам выдан мут', text: `На сервере **${guild}** вы не можете писать и говорить${o.minutes ? ` ${durationLabel(o.minutes)}` : ''}. Когда срок кончится, всё вернётся само.` };
    case 'unmute': return { title: '🔊 Мут снят', text: `На сервере **${guild}** вы снова можете писать и говорить.` };
    case 'warn': {
      const scale = o.scale ?? 0;
      const tail = o.expiresAt ? ` Это предупреждение перестанет учитываться ${timeTag(o.expiresAt)}.` : '';
      const count = o.warnNo && scale ? ` Ваши предупреждения: ${warnBar(o.warnNo, scale)}.` : '';
      return { title: `⚠️ Предупреждение${o.warnNo ? ` №${o.warnNo}` : ''}`, text: `Администрация сервера **${guild}** вынесла вам предупреждение.${count} Повторные нарушения могут привести к муту, исключению или блокировке.${tail}` };
    }
  }
}

/** ●●○○○ 2 из 5: the scale of warnings (up to 10 marks) */
export function warnBar(n: number, max: number): string {
  const m = Math.max(1, Math.min(10, max));
  const full = Math.max(0, Math.min(m, n));
  return `${'●'.repeat(full)}${'○'.repeat(m - full)} ${n} из ${max}`;
}

/** the colour of a warning card gets warmer with each warning: yellow, orange, red */
export function warnColor(n: number, max: number): number {
  const r = max > 0 ? n / max : 1;
  return r < 0.4 ? 0xf5b01e : r < 0.8 ? 0xe67e22 : 0xe74c3c;
}

/** «10 мин», «2 ч», «1 д 2 ч», «28 д» */
export function durationLabel(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return [d ? `${d} д` : '', h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ') || '0 мин';
}

/** a timeout of Discord lasts 28 days at most */
export const MAX_MUTE_MINUTES = 40_320;
export const DURATION_PRESETS: readonly [string, string][] = [
  ['10 минут', '10m'], ['1 час', '1h'], ['6 часов', '6h'], ['1 день', '1d'], ['3 дня', '3d'], ['7 дней', '7d'], ['28 дней', '28d'],
];

/** «30», «30m», «2h», «1d», «1w», «10 мин», «2 ч», «3 дн»: minutes (1..40320), or null when it cannot be understood */
export function parseDuration(text: string): number | null {
  const m = /^(\d{1,6})\s*(m|min|мин|м|h|hr|ч|час|d|д|дн|w|н|нед)?$/i.exec(text.trim());
  if (!m) return null;
  const unit = (m[2] ?? 'm').toLowerCase();
  const k = unit.startsWith('h') || unit === 'ч' || unit === 'час' ? 60 : unit.startsWith('d') || unit === 'д' || unit === 'дн' ? 1440 : unit.startsWith('w') || unit === 'н' || unit === 'нед' ? 10_080 : 1;
  const minutes = Number(m[1]) * k;
  return minutes >= 1 && minutes <= MAX_MUTE_MINUTES ? minutes : null;
}

/** the reasons that fit what is typed (all of them while nothing is typed), at most 25 */
export function reasonHints(reasons: string[], typed: string): { name: string; value: string }[] {
  const q = typed.trim().toLowerCase();
  return reasons.filter((r) => !q || r.toLowerCase().includes(q)).slice(0, 25).map((r) => ({ name: r.slice(0, 100), value: r.slice(0, 100) }));
}

/** the presets of a mute that fit what is typed */
export function durationHints(typed: string): { name: string; value: string }[] {
  const q = typed.trim().toLowerCase();
  const out = DURATION_PRESETS.filter(([name, v]) => !q || name.includes(q) || v.includes(q)).map(([name, value]) => ({ name, value }));
  const own = parseDuration(typed);
  if (own && !out.some((o) => parseDuration(o.value) === own)) out.unshift({ name: durationLabel(own), value: typed.trim() });
  return out;
}

/** a link to a message, kept in the record as the ground for a warning */
export const messageLink = (guildId: string, channelId: string, messageId: string): string => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

/** the buttons under a result card: «Undo» works thirty seconds */
export const UNDO_MS = 30_000;
export const undoId = (caseId: number, at: number): string => `mod:undo:${caseId}:${at.toString(36)}`;
export function parseUndoId(id: string): { caseId: number; at: number } | null {
  const m = /^mod:undo:(\d{1,10}):([0-9a-z]{1,12})$/.exec(id);
  return m ? { caseId: Number(m[1]), at: parseInt(m[2] as string, 36) } : null;
}
export const undoFresh = (at: number, now: number): boolean => now - at >= 0 && now - at <= UNDO_MS + 5000;

export type UserButton = 'hist' | 'more' | 'unb' | 'unm';
export const userBtnId = (kind: UserButton, userId: string): string => `mod:${kind}:${userId}`;
export function parseUserBtn(id: string): { kind: UserButton; userId: string } | null {
  const m = /^mod:(hist|more|unb|unm):(\d{15,25})$/.exec(id);
  return m ? { kind: m[1] as UserButton, userId: m[2] as string } : null;
}

/** the window with the reason of a warning (from a button or a context menu); `chan`/`msg` are 0 when there is no message */
export const reasonModalId = (userId: string, chan = '0', msg = '0'): string => `modr:w:${userId}:${chan}:${msg}`;
export function parseReasonModal(id: string): { userId: string; chan: string; msg: string } | null {
  const m = /^modr:w:(\d{15,25}):(\d{1,25}):(\d{1,25})$/.exec(id);
  return m ? { userId: m[1] as string, chan: m[2] as string, msg: m[3] as string } : null;
}

/** appeals: the button in the private message, its window, the buttons for the administrators */
export const appealGoId = (guildId: string): string => `appeal:go:${guildId}`;
export const appealSendId = (guildId: string): string => `appeal:send:${guildId}`;
export const appealDecideId = (ok: boolean, guildId: string, userId: string): string => `appeal:${ok ? 'ok' : 'no'}:${guildId}:${userId}`;
export function parseAppeal(id: string): { kind: 'go' | 'send' | 'ok' | 'no'; guildId: string; userId: string } | null {
  const m = /^appeal:(go|send|ok|no):(\d{15,25})(?::(\d{15,25}))?$/.exec(id);
  return m ? { kind: m[1] as 'go' | 'send' | 'ok' | 'no', guildId: m[2] as string, userId: m[3] ?? '' } : null;
}
/** one appeal per person in this time */
export const APPEAL_PAUSE_MS = 12 * 3600_000;

/** the line after the third warning and every further one */
export const WARN_ESCALATE_AT = 3;
export const escalationHint = (total: number): string => (total >= WARN_ESCALATE_AT ? `Это уже ${total}-е предупреждение: подумайте о кике или бане.` : '');

/** a short token for the buttons of a confirmation (the reason does not fit in a button id) */
export const newToken = (rand: () => number = Math.random): string => Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)]).join('');

export const punishId = (action: 'go' | 'no', token: string): string => `mod:${action}:${token}`;

export function parsePunishId(id: string): { action: 'go' | 'no'; token: string } | null {
  const m = /^mod:(go|no):([0-9a-z]{6,12})$/.exec(id);
  return m ? { action: m[1] as 'go' | 'no', token: m[2] as string } : null;
}

export const isStale = (at: number, now: number): boolean => !(now - at >= 0 && now - at <= PUNISH_TTL_MS);

/** a user id from the text of the /unban option: only the digits of an id or a mention <@id> */
export function idFromInput(s: string): string | null {
  const m = /^<@!?(\d{15,25})>$|^(\d{15,25})$/.exec(s.trim());
  return m ? ((m[1] ?? m[2]) as string) : null;
}

/** the audit log of Discord keeps 512 characters: «moderator: reason» */
export const auditReason = (mod: string, reason: string): string => `${mod}: ${reason}`.slice(0, 500);

/** «3 дня», «1 день», «7 дней» */
export const daysText = (n: number): string => (n === 0 ? 'не удалять' : n === 1 ? 'за 1 день' : `за ${n} дней`);

export const BAN_PAGE = 10;

/** the page of a list: the page is kept inside the list, `from`/`to` cut the items */
export function paginate(total: number, page: number, size = BAN_PAGE): { page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(pages - 1, Math.max(0, Number.isInteger(page) ? page : 0));
  return { page: p, pages, from: p * size, to: Math.min(total, (p + 1) * size) };
}

/** a line of the ban list: «**name** · `id` — reason» */
export function banLine(b: { id: string; username: string; reason: string }): string {
  const name = b.username.replace(/[*_~`|>\\]/g, '');
  return `**${name}** · \`${b.id}\`${b.reason ? ` — ${b.reason.replace(/\s+/g, ' ').slice(0, 70)}` : ''}`;
}

export const pageId = (n: number): string => `mod:pg:${n}`;
export const parsePageId = (id: string): number | null => {
  const m = /^mod:pg:(\d{1,3})$/.exec(id);
  return m ? Number(m[1]) : null;
};
export const PICK_ID = 'modban:pick';

/** a time in the style of Discord that shows in the reader's own time zone: <t:…:R> */
export const timeTag = (ms: number): string => `<t:${Math.floor(ms / 1000)}:R>`;

/** the body of a result card: short lines with icons instead of a column of one-word fields (they stack badly on a phone) */
export function cardBody(o: { done: string; targetId: string; targetName: string; modId: string; reason: string; bar?: string; chips: string[] }): string {
  const lines = [`<@${o.targetId}> ${o.done}.`];
  if (o.bar) lines.push(o.bar);
  lines.push('', `👤 **${o.targetName}**  ·  🛡️ <@${o.modId}>`, `📝 ${o.reason || 'причина не указана'}`);
  if (o.chips.length) lines.push(o.chips.join('  ·  '));
  return lines.join('\n');
}
