import { describe, expect, it } from 'vitest';
import { buildRows, dayKey, dayWord, groupByDay, matchesStatus, repeaters, visitMinutes, type ConnectionItem } from '../src/pages/connectionsLogic';

const MIN = 60_000;
const T0 = new Date('2026-11-18T12:00:00').getTime();
let n = 0;
const ev = (kind: 'join' | 'leave', at: number, p: Partial<ConnectionItem> = {}): ConnectionItem => ({
  id: ++n, serverId: 1, serverName: 'S', ts: T0 + at * MIN, kind, platformId: 'p1', nick: 'Carline', reason: kind === 'leave' ? 'LeftGame' : '', removedBy: '', minutes: -1, ...p,
});
const newestFirst = (xs: ConnectionItem[]) => [...xs].sort((a, b) => b.ts - a.ts);

describe('buildRows', () => {
  it('puts a join and its departure into one line, using the minutes in the game', () => {
    const rows = buildRows(newestFirst([ev('join', 0), ev('leave', 22, { minutes: 22 })]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.join).not.toBeNull();
    expect(rows[0]!.leave).not.toBeNull();
    expect(rows[0]!.inGame).toBe(false);
    expect(visitMinutes(rows[0]!)).toBe(22);
  });
  it('a join without a departure is a visit that goes on', () => {
    const rows = buildRows([ev('join', 5)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.inGame).toBe(true);
  });
  it('a departure whose join is not loaded stays alone', () => {
    const rows = buildRows([ev('leave', 30, { minutes: 20 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.join).toBeNull();
  });
  it('does not pair across players or give one join to two departures', () => {
    const rows = buildRows(newestFirst([
      ev('join', 0), ev('leave', 10, { minutes: 10 }),
      ev('join', 12), ev('leave', 14, { minutes: 2 }),
      ev('join', 3, { platformId: 'p2', nick: 'Other' }),
    ]));
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.leave && r.join)).toHaveLength(2);
    expect(rows.find((r) => r.who === 'p2')!.inGame).toBe(true);
  });
  it('the same player on two servers is not mixed up', () => {
    const rows = buildRows(newestFirst([ev('join', 0), ev('join', 1, { serverId: 2, serverName: 'B' }), ev('leave', 10, { minutes: 10 })]));
    expect(rows.find((r) => r.serverId === 1)!.leave).not.toBeNull();
    expect(rows.find((r) => r.serverId === 2)!.inGame).toBe(true);
  });
});

describe('filters', () => {
  it('sorts the statuses', () => {
    const rows = buildRows(newestFirst([
      ev('leave', 1, { minutes: 1 }), ev('leave', 2, { platformId: 'a', reason: 'Timeout', minutes: 5 }),
      ev('leave', 3, { platformId: 'b', reason: 'Kicked', minutes: 5 }), ev('leave', 4, { platformId: 'c', removedBy: 'warn', minutes: 5 }), ev('join', 5, { platformId: 'd' }),
    ]));
    const count = (s: Parameters<typeof matchesStatus>[1]) => rows.filter((r) => matchesStatus(r, s)).length;
    expect(count('all')).toBe(5);
    expect(count('self')).toBe(1);
    expect(count('timeout')).toBe(1);
    expect(count('kicked')).toBe(2);
    expect(count('inGame')).toBe(1);
  });
});

describe('repeaters', () => {
  it('three joins within an hour mark the player', () => {
    expect(repeaters([ev('join', 0), ev('join', 20), ev('join', 50)]).has('p1')).toBe(true);
    expect(repeaters([ev('join', 0), ev('join', 20), ev('join', 90)]).has('p1')).toBe(false);
  });
});

describe('days', () => {
  it('groups rows by local day and names today / yesterday', () => {
    const rows = buildRows(newestFirst([ev('join', 0, { platformId: 'x' }), ev('join', -24 * 60, { platformId: 'y' })]));
    const g = groupByDay(rows);
    expect(g).toHaveLength(2);
    expect(dayWord(dayKey(T0), T0)).toBe('today');
    expect(dayWord(dayKey(T0 - 24 * 60 * MIN), T0)).toBe('yesterday');
    expect(dayWord('2020-01-01', T0)).toBeNull();
  });
});
