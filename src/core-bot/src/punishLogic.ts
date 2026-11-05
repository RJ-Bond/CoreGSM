/** /ban, /unban, /kick, /warn: pure logic (checks of who may act on whom, texts, the waiting confirmations). No discord.js import. */

export type PunishAction = 'ban' | 'unban' | 'kick' | 'warn';

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
};

/** what the person is told in a private message */
export function dmText(action: PunishAction, guild: string, warnNo?: number): { title: string; text: string } {
  switch (action) {
    case 'ban': return { title: '🔨 Вы заблокированы', text: `Администрация сервера **${guild}** заблокировала вас.` };
    case 'kick': return { title: '👢 Вас исключили с сервера', text: `Вас исключили с сервера **${guild}**. Вернуться можно по новому приглашению, если правила для вас понятны.` };
    case 'unban': return { title: '🔓 Вы разблокированы', text: `Блокировка на сервере **${guild}** снята.` };
    case 'warn': return { title: `⚠️ Предупреждение${warnNo ? ` №${warnNo}` : ''}`, text: `Администрация сервера **${guild}** вынесла вам предупреждение. Повторные нарушения могут привести к исключению или блокировке.` };
  }
}

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

/** a time in the style of Discord that shows in the reader's own time zone: <t:…:R> */
export const timeTag = (ms: number): string => `<t:${Math.floor(ms / 1000)}:R>`;
