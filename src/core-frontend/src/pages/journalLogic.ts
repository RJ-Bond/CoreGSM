/** The journal of the game plugin: what is a problem, what advice goes with an error, what belongs together, days. */
import { dayKey } from './connectionsLogic';

export type Kind = 'message' | 'auto' | 'discord' | 'restart' | 'link' | 'mod' | 'plugin' | 'conn';
export interface Entry {
  id: string; ts: number; kind: Kind; serverId: number | null; serverName: string; text: string; status: string; error: string; by: string;
  /** a message: when the plugin took it, and how many players saw it (null / undefined = the plugin did not say) */
  deliveredAt?: number | null;
  shown?: number | null;
}

export const FILTERS = ['all', 'problems', 'message', 'auto', 'discord', 'restart', 'plugin', 'link', 'mod'] as const;
export type Filter = (typeof FILTERS)[number];
export const PLUGIN_KINDS = ['mass', 'ping', 'steam', 'freeze', 'save', 'other'] as const;

export const isMessage = (e: Entry): boolean => e.kind === 'message' || e.kind === 'auto' || e.kind === 'discord';

/** what did not go well: a message that did not reach the game, a missed restart, a note of the plugin that is not a plain save */
export const isProblem = (e: Entry): boolean =>
  (isMessage(e) && (e.status === 'failed' || e.status === 'expired')) || (e.kind === 'restart' && e.status === 'missed') || (e.kind === 'plugin' && e.status !== 'save');

/** the key of the advice for the error of an entry (what to do about it), or null */
export function adviceKey(e: Entry): 'gn.jn.adv.expired' | 'gn.jn.adv.token' | 'gn.jn.adv.world' | null {
  if (!isMessage(e) || !(e.status === 'failed' || e.status === 'expired')) return null;
  if (/не забрал/i.test(e.error)) return 'gn.jn.adv.expired';
  if (/не создан токен/i.test(e.error)) return 'gn.jn.adv.token';
  if (/мир сервера/i.test(e.error)) return 'gn.jn.adv.world';
  return null;
}

/** how long the plugin took to take a message, in seconds with a tenth (null when it is not known) */
export function tookSeconds(e: Entry): number | null {
  if (!isMessage(e) || e.deliveredAt == null || e.deliveredAt < e.ts) return null;
  return Math.round((e.deliveredAt - e.ts) / 100) / 10;
}

/**
 * What belongs to an entry: the other sends of the same rule (an automatic announcement), the countdown messages of a restart
 * (those of «авто: рестарт» of the same server around its start). Never the entry itself.
 */
export function relatedOf(e: Entry, all: Entry[], limit = 6): Entry[] {
  if (e.kind === 'auto' && e.by) return all.filter((x) => x.id !== e.id && x.kind === 'auto' && x.by === e.by && x.serverId === e.serverId).slice(0, limit);
  if (e.kind === 'restart') {
    const minutes = Number(e.text) || 10;
    return all.filter((x) => x.kind === 'auto' && x.by === 'авто: рестарт' && x.serverId === e.serverId && x.ts >= e.ts - 60_000 && x.ts <= e.ts + (minutes + 5) * 60_000).slice(0, limit);
  }
  return [];
}

export interface DayGroup<T> { day: string; items: T[] }
/** entries newest first, cut into local days */
export function groupDays<T extends { ts: number }>(list: T[]): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  for (const e of list) {
    const day = dayKey(e.ts);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(e);
    else out.push({ day, items: [e] });
  }
  return out;
}

/** the days a journal may be kept for (the choice of the administrator) */
export const KEEP_DAYS = [7, 14, 30, 90, 180, 365] as const;
