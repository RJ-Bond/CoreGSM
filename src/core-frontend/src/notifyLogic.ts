/** The notification centre: which group a notification belongs to, and how a list is cut into groups and days. */
import type { NotificationItem } from './notifications';
import { dayKey, dayWord } from './pages/connectionsLogic';

export type NotifyGroup = 'outage' | 'slots' | 'security' | 'other';
export const NOTIFY_GROUPS: NotifyGroup[] = ['outage', 'slots', 'security', 'other'];

/** a server went down or is back; a free place; a new device, a changed or reset password; the rest */
export function groupOf(kind: string): NotifyGroup {
  if (kind === 'went_down' || kind === 'back_online') return 'outage';
  if (kind === 'free_slot' || kind === 'peak' || kind === 'low') return 'slots';
  if (kind === 'newdevice' || kind === 'changed' || kind === 'reset') return 'security';
  return 'other';
}

export function groupCounts(items: NotificationItem[]): Record<NotifyGroup | 'all', number> {
  const c: Record<NotifyGroup | 'all', number> = { all: items.length, outage: 0, slots: 0, security: 0, other: 0 };
  for (const n of items) c[groupOf(n.kind)] += 1;
  return c;
}

export function inGroup(items: NotificationItem[], g: NotifyGroup | 'all'): NotificationItem[] {
  return g === 'all' ? items : items.filter((n) => groupOf(n.kind) === g);
}

export interface NotifyDay { day: string; word: 'today' | 'yesterday' | null; items: NotificationItem[] }
/** newest first, cut into local days */
export function byDay(items: NotificationItem[], now = Date.now()): NotifyDay[] {
  const out: NotifyDay[] = [];
  for (const n of items) {
    const day = dayKey(n.ts);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(n);
    else out.push({ day, word: dayWord(day, now), items: [n] });
  }
  return out;
}

/** the unread ones of a group */
export const unreadIn = (items: NotificationItem[], g: NotifyGroup | 'all'): number => inGroup(items, g).filter((n) => !n.read).length;
