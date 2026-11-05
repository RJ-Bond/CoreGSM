/** /clear: pure logic (button ids, which messages can be deleted, texts). No discord.js import. */

/** Discord deletes messages in bulk only when they are younger than 14 days; an hour of margin for the request itself */
export const BULK_MAX_AGE_MS = 14 * 24 * 3600_000 - 3600_000;
/** the confirmation buttons stop working after this time */
export const CONFIRM_TTL_MS = 2 * 60_000;
/** one run never lasts longer than this (the private reply of Discord lives 15 minutes) */
export const MAX_RUN_MS = 10 * 60_000;
/** the largest number a person can ask to delete in one go */
export const MAX_COUNT = 10_000;

export type ClearAction = 'go' | 'no' | 'stop';

export interface ClearId {
  action: ClearAction;
  /** who may press the button */
  userId: string;
  /** how many messages to delete, 0 = all */
  count: number;
  /** when the confirmation was made (ms) */
  at: number;
}

export const clearId = (action: ClearAction, userId: string, count: number, at: number): string => `clear:${action}:${userId}:${count}:${at.toString(36)}`;

/** the id of the stop button: any admin may stop the run, so it carries the channel instead of the person */
export const stopId = (channelId: string): string => `clear:stop:${channelId}:0:0`;

export function parseClearId(id: string): ClearId | null {
  const m = /^clear:(go|no|stop):(\d{1,25}):(\d{1,5}):([0-9a-z]{1,12})$/.exec(id);
  if (!m) return null;
  return { action: m[1] as ClearAction, userId: m[2] as string, count: Number(m[3]), at: parseInt(m[4] as string, 36) };
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
}

/**
 * Sorts a page of messages: `del` can go in bulk, `pinned` stay (pinned messages are never deleted), `old` are too old for a
 * bulk delete. `room` is how many more messages may be deleted (Infinity for «all»).
 */
export function sortPage(page: MsgLike[], now: number, room: number): { del: string[]; pinned: number; old: number } {
  const del: string[] = [];
  let pinned = 0;
  let old = 0;
  for (const m of page) {
    if (m.pinned) pinned++;
    else if (now - m.createdTimestamp >= BULK_MAX_AGE_MS) old++;
    else if (del.length < room) del.push(m.id);
  }
  return { del, pinned, old };
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
