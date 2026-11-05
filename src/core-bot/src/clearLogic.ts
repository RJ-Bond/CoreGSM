/** /clear: pure logic (button ids, which messages can be deleted, estimates, texts). No discord.js import. */

/** Discord deletes messages in bulk only when they are younger than 14 days; an hour of margin for the request itself */
export const BULK_MAX_AGE_MS = 14 * 24 * 3600_000 - 3600_000;
/** the confirmation buttons stop working after this time */
export const CONFIRM_TTL_MS = 2 * 60_000;
/** one run never lasts longer than this (the private reply of Discord lives 15 minutes) */
export const MAX_RUN_MS = 10 * 60_000;
/** the largest number a person can ask to delete in one go */
export const MAX_COUNT = 10_000;
/** how many messages the preview looks through (ten requests) */
export const SCAN_LIMIT = 1000;
/** seconds between the confirmation and the first deletion: time to press «Stop» */
export const COUNTDOWN_SECONDS = 3;
/** the quick amounts under the confirmation; 0 = the whole chat */
export const QUICK_COUNTS = [10, 50, 100, 0] as const;

export type ClearAction = 'go' | 'no' | 'stop' | 'set' | 'info';

/** what the person has chosen so far; it travels in the id of every button, so nothing is stored on the server */
export interface ClearState {
  /** how many messages to delete, 0 = all */
  count: number;
  /** delete pinned messages too (by default they stay) */
  pinned: boolean;
  /** only the messages of this member ('' = everybody) */
  target: string;
  /** delete messages older than 14 days too, one by one (slow) */
  old: boolean;
}

export interface ClearId extends ClearState {
  action: ClearAction;
  /** who may press the button */
  userId: string;
  /** when the confirmation was made (ms) */
  at: number;
}

export const clearId = (action: ClearAction, userId: string, st: ClearState, at: number): string =>
  `clear:${action}:${userId}:${st.count}:${at.toString(36)}:${st.pinned ? 1 : 0}:${st.target || 0}:${st.old ? 1 : 0}`;

/** the id of the stop button: any moderator may stop the run, so it carries the channel instead of the person */
export const stopId = (channelId: string): string => `clear:stop:${channelId}:0:0:0:0:0`;

export function parseClearId(id: string): ClearId | null {
  const m = /^clear:(go|no|stop|set|info):(\d{1,25}):(\d{1,5}):([0-9a-z]{1,12}):([01]):(\d{1,25}):([01])$/.exec(id);
  if (!m) return null;
  return { action: m[1] as ClearAction, userId: m[2] as string, count: Number(m[3]), at: parseInt(m[4] as string, 36), pinned: m[5] === '1', target: m[6] === '0' ? '' : (m[6] as string), old: m[7] === '1' };
}

export const isExpired = (at: number, now: number): boolean => !(now - at >= 0 && now - at <= CONFIRM_TTL_MS);

/** what the person asked for: a whole number from 1 to MAX_COUNT, anything else (empty too) means «everything» → 0 */
export function normalizeCount(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? Math.min(v, MAX_COUNT) : 0;
}

export interface MsgLike {
  id: string;
  createdTimestamp: number;
  pinned: boolean;
  authorId: string;
}

export interface Sorted {
  /** can be deleted in bulk */
  del: string[];
  /** older than 14 days, to be deleted one by one (only when the person chose it) */
  slow: string[];
  /** pinned messages that stay */
  pinned: number;
  /** too old for a bulk delete and left in place */
  old: number;
}

/**
 * Sorts a page of messages: `del` can go in bulk, `pinned` stay (unless the person chose to delete them), `old` are too old for
 * a bulk delete. With a target only the messages of that member are looked at. `room` is how many more messages may be
 * deleted (Infinity for «all»).
 */
export function sortPage(page: MsgLike[], now: number, st: Pick<ClearState, 'pinned' | 'target'> & { old?: boolean }, room: number): Sorted {
  const r: Sorted = { del: [], slow: [], pinned: 0, old: 0 };
  for (const m of page) {
    if (st.target && m.authorId !== st.target) continue;
    if (m.pinned && !st.pinned) r.pinned++;
    else if (now - m.createdTimestamp >= BULK_MAX_AGE_MS) {
      if (st.old && r.del.length + r.slow.length < room) r.slow.push(m.id);
      else r.old++;
    } else if (r.del.length + r.slow.length < room) r.del.push(m.id);
  }
  return r;
}

export interface Estimate {
  /** messages looked through */
  scanned: number;
  /** the whole chat was looked through (it has no more than SCAN_LIMIT messages) */
  complete: boolean;
  deletable: number;
  /** of them: too old for a bulk delete, deleted one by one */
  slow: number;
  pinned: number;
  old: number;
}

/** the preview under the confirmation: what the run would do with the messages found */
export function estimate(list: MsgLike[], complete: boolean, now: number, st: ClearState): Estimate {
  const s = sortPage(list, now, st, st.count || Infinity);
  return { scanned: list.length, complete, deletable: s.del.length + s.slow.length, slow: s.slow.length, pinned: s.pinned, old: s.old };
}

/** the number the progress bar counts to; 0 when it is not known (the chat is longer than the preview looked through) */
export function expectedTotal(e: Estimate | null, count: number): number {
  if (!e) return 0;
  if (count) return e.deletable >= count || e.complete ? e.deletable : 0;
  return e.complete ? e.deletable : 0;
}

/** «5 сообщений», «1 сообщение», «2 сообщения» */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  const f = a > 10 && a < 20 ? forms[2] : b === 1 ? forms[0] : b >= 2 && b <= 4 ? forms[1] : forms[2];
  return `${n} ${f}`;
}

export const messages = (n: number) => plural(n, ['сообщение', 'сообщения', 'сообщений']);

/** «1 мин 5 с» / «12 с» */
export function durationText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} мин ${s % 60} с` : `${s} с`;
}

/** messages per second as text: «87 сообщ./с», «2,5 сообщ./с»; empty while nothing is known */
export function speedText(deleted: number, elapsedMs: number): string {
  if (deleted <= 0 || elapsedMs < 500) return '';
  const v = deleted / (elapsedMs / 1000);
  return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace('.', ',')} сообщ./с`;
}

/** time left by the speed so far; empty while it cannot be told */
export function etaText(deleted: number, total: number, elapsedMs: number): string {
  if (deleted <= 0 || total <= deleted || elapsedMs < 500) return '';
  return `≈ ${durationText(((total - deleted) / deleted) * elapsedMs)}`;
}

/** milliseconds until the channel may be cleaned again (0 = now); `cooldownMin` 0 switches the pause off */
export const cooldownLeft = (lastAt: number | undefined, cooldownMin: number, now: number): number => (lastAt === undefined || cooldownMin <= 0 ? 0 : Math.max(0, lastAt + cooldownMin * 60_000 - now));

/** one message deleted on its own takes about a third of a second (Discord's limit) */
export const SLOW_PER_SECOND = 3;

/** a rough wait: «3 мин» / «40 с» */
export const waitText = (ms: number): string => (ms >= 60_000 ? `${Math.ceil(ms / 60_000)} мин` : `${Math.max(1, Math.ceil(ms / 1000))} с`);

/** the line of the public notice */
export const DONE_LINES: readonly string[] = [
  'Чисто, как после пятничного деплоя ✨',
  'Как будто здесь ничего и не было 🫧',
  'Уборка завершена, можно начинать с чистого листа 🧼',
  'Пыль осела, тишина и порядок 🌿',
  'Генеральная уборка выполнена. Тапочки у входа 🩴',
  'Мусор вынесен, окна открыты 🪟',
];

export function pickLine(rand: number): string {
  return DONE_LINES[Math.min(DONE_LINES.length - 1, Math.max(0, Math.floor(rand * DONE_LINES.length)))] as string;
}

/** the moderation settings of the panel; the defaults are used only to read a broken answer */
export interface Moderation {
  enabled: boolean;
  /** /ban, /unban, /kick and /warn */
  punish: boolean;
  logChannelId: string;
  protectedChannels: string[];
  cooldown: number;
  /** the reasons offered while a moderator types a punishment */
  reasons: string[];
  /** where the appeals of the banned arrive (empty = the log channel) */
  appealChannelId: string;
}

export function readModeration(v: unknown): Moderation | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<Moderation>;
  if (typeof o.enabled !== 'boolean' || !Array.isArray(o.protectedChannels)) return null;
  return {
    enabled: o.enabled,
    punish: o.punish !== false,
    logChannelId: typeof o.logChannelId === 'string' && /^\d{15,25}$/.test(o.logChannelId) ? o.logChannelId : '',
    protectedChannels: o.protectedChannels.filter((x): x is string => typeof x === 'string'),
    cooldown: typeof o.cooldown === 'number' && o.cooldown >= 0 ? o.cooldown : 0,
    reasons: Array.isArray(o.reasons) ? o.reasons.filter((x): x is string => typeof x === 'string').slice(0, 25) : [],
    appealChannelId: typeof o.appealChannelId === 'string' && /^\d{15,25}$/.test(o.appealChannelId) ? o.appealChannelId : '',
  };
}

export interface LogInfo {
  modId: string;
  channelId: string;
  deleted: number;
  elapsedMs: number;
  pinned: number;
  old: number;
  count: number;
  target: string;
  keepPinned: boolean;
  includeOld: boolean;
  reason: string;
  /** how many cleanings this channel had in the last week, this one included (0 = unknown) */
  weekN?: number;
}

/** the title of the record in the log channel: what happened in a few words */
export const logTitle = (outcome: 'ok' | 'stopped' | 'error'): string =>
  outcome === 'ok' ? '🧹 Канал очищен' : outcome === 'stopped' ? '⏹️ Очистка остановлена' : '⚠️ Очистка не удалась';

/** the body of the record: short lines with icons instead of a column of one-word fields (they stack badly on a phone) */
export function logDescription(o: LogInfo): string {
  const speed = speedText(o.deleted, o.elapsedMs);
  const lines = [
    `👮 <@${o.modId}>  ·  📍 <#${o.channelId}>`,
    `🗑️ **${messages(o.deleted)}**  ·  ⏱️ ${durationText(o.elapsedMs)}${speed ? `  ·  ⚡ ${speed}` : ''}`,
    `🎯 ${o.count ? `последние ${o.count}` : 'весь чат'}${o.target ? `, только <@${o.target}>` : ''}${o.keepPinned ? '' : ', включая закреплённые'}${o.includeOld ? ', включая старше 14 дней' : ''}`,
  ];
  const left = [o.pinned ? `📌 закреплённых оставлено: **${o.pinned}**` : '', o.old ? `⏳ старше 14 дней осталось: **${o.old}+**` : ''].filter(Boolean);
  if (left.length) lines.push(left.join('  ·  '));
  if ((o.weekN ?? 0) >= 2) lines.push(`🔁 ${o.weekN}-я очистка этого канала за неделю`);
  if (o.reason) lines.push(`💬 ${o.reason.slice(0, 500)}`);
  return lines.join('\n');
}

export const WEEK_MS = 7 * 24 * 3600_000;

/** remembers a cleaning of the channel and tells how many there were in the last week (this one included) */
export function noteCleaning(log: Map<string, number[]>, channelId: string, now: number): number {
  const list = (log.get(channelId) ?? []).filter((t) => now - t < WEEK_MS);
  list.push(now);
  log.set(channelId, list);
  return list.length;
}
