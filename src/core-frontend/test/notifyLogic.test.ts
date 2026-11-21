import { describe, expect, it } from 'vitest';
import { byDay, groupCounts, groupOf, inGroup, unreadIn } from '../src/notifyLogic';
import type { NotificationItem } from '../src/notifications';

const NOW = new Date('2026-11-21T12:00:00').getTime();
const n = (id: number, kind: string, ago: number, read = false): NotificationItem => ({ id, ts: NOW - ago, kind, serverId: 1, text: 't', read });
const DAY = 86_400_000;
const items = [n(1, 'went_down', 1000), n(2, 'back_online', 2000, true), n(3, 'free_slot', 3000), n(4, 'newdevice', DAY), n(5, 'test', 2 * DAY)];

describe('the groups of notifications', () => {
  it('puts a kind into its group', () => {
    expect(groupOf('went_down')).toBe('outage');
    expect(groupOf('back_online')).toBe('outage');
    expect(groupOf('free_slot')).toBe('slots');
    expect(groupOf('newdevice')).toBe('security');
    expect(groupOf('reset')).toBe('security');
    expect(groupOf('anything else')).toBe('other');
  });
  it('counts, filters and counts the unread of a group', () => {
    expect(groupCounts(items)).toEqual({ all: 5, outage: 2, slots: 1, security: 1, other: 1 });
    expect(inGroup(items, 'outage').map((x) => x.id)).toEqual([1, 2]);
    expect(inGroup(items, 'all')).toHaveLength(5);
    expect(unreadIn(items, 'outage')).toBe(1);
    expect(unreadIn(items, 'all')).toBe(4);
  });
  it('cuts a list into days: today, yesterday and older', () => {
    const d = byDay(items, NOW);
    expect(d.map((x) => x.items.length)).toEqual([3, 1, 1]);
    expect(d.map((x) => x.word)).toEqual(['today', 'yesterday', null]);
  });
});
