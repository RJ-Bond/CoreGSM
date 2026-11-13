import { describe, expect, it } from 'vitest';
import { delta, dayKey, groupAudit, healthScore, type HealthInput } from './adminLogic';
import { moveId, parseColumns } from './adminServersLogic';

const fine: HealthInput = { servers: 4, down: 0, botError: false, certDays: 60, pending: 0, updateAvailable: false, backupAgeMs: 1000, backupsKnown: true };

describe('healthScore', () => {
  it('is 100 when all is fine', () => {
    expect(healthScore(fine)).toEqual({ score: 100, reasons: [] });
  });
  it('subtracts every problem and lists it', () => {
    const r = healthScore({ ...fine, down: 1, botError: true, pending: 2 });
    expect(r.reasons.map((x) => x.id)).toEqual(['down', 'bot', 'pending']);
    expect(r.score).toBe(100 - r.reasons.reduce((n, x) => n + x.cost, 0));
    expect(r.score).toBeLessThan(70);
  });
  it('flags a missing backup but not when backups are unknown', () => {
    expect(healthScore({ ...fine, backupAgeMs: null }).reasons.map((x) => x.id)).toEqual(['backup']);
    expect(healthScore({ ...fine, backupAgeMs: null, backupsKnown: false }).reasons).toEqual([]);
  });
  it('never goes below zero', () => {
    const r = healthScore({ servers: 1, down: 1, botError: true, certDays: -1, pending: 50, updateAvailable: true, backupAgeMs: null, backupsKnown: true });
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});

describe('delta', () => {
  it('is null for equal or unknown', () => {
    expect(delta(3, 3)).toBeNull();
    expect(delta(3, null)).toBeNull();
  });
  it('signs the difference', () => {
    expect(delta(5, 3)).toEqual({ text: '+2', tone: 'up' });
    expect(delta(1, 3)).toEqual({ text: '−2', tone: 'down' });
  });
});

describe('dayKey', () => {
  it('pads month and day', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('chords', () => {
  it('maps both ways', async () => {
    const { CHORDS, chordOf } = await import('./adminLogic');
    expect(CHORDS.s).toBe('servers');
    expect(chordOf('servers')).toBe('s');
    expect(chordOf('cards')).toBeNull();
  });
});

describe('moveId', () => {
  it('swaps with the neighbour on screen', () => {
    expect(moveId([1, 2, 3], [1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveId([1, 2, 3], [1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
  });
  it('cannot move past the ends', () => {
    expect(moveId([1, 2], [1, 2], 1, -1)).toBeNull();
    expect(moveId([1, 2], [1, 2], 2, 1)).toBeNull();
  });
  it('works among a subset of the list', () => {
    expect(moveId([1, 2, 3, 4], [2, 4], 4, -1)).toEqual([1, 4, 3, 2]);
  });
});

describe('parseColumns', () => {
  it('nothing saved: the default columns', () => expect(parseColumns(null)).toEqual(['uptime', 'h24']));
  it('keeps the table order and drops unknown ones', () => expect(parseColumns('["updated","map","zzz"]')).toEqual(['map', 'updated']));
  it('an empty choice stays empty', () => expect(parseColumns('[]')).toEqual([]));
  it('broken data: the default columns', () => {
    expect(parseColumns('{')).toEqual(['uptime', 'h24']);
    expect(parseColumns('5')).toEqual(['uptime', 'h24']);
  });
});

describe('the groups of the journal', () => {
  const row = (id: number, minAgo: number, action = 'Добавлен сервер', actor = 'admin') => ({ id, ts: 1_000_000_000 - minAgo * 60_000, actor, action, detail: `s${id}` });
  it('folds the same action of one person that follows within minutes, and nothing else', () => {
    const g = groupAudit([row(1, 1), row(2, 2), row(3, 3), row(4, 4, 'Вход'), row(5, 5), row(6, 40)]);
    expect(g.map((x) => x.rows.map((r) => r.id))).toEqual([[1, 2, 3], [4], [5], [6]]);
    expect(groupAudit([row(1, 1, 'A', 'x'), row(2, 2, 'A', 'y')]).length).toBe(2);
    expect(groupAudit([])).toEqual([]);
  });
});

describe('the warnings of the health page in the score', () => {
  it('cost a few points each, at most fifteen, and nothing without them', () => {
    expect(healthScore({ ...fine, flags: 0 }).score).toBe(100);
    const one = healthScore({ ...fine, flags: 1 });
    expect(one.score).toBe(93);
    expect(one.reasons.map((r) => r.id)).toContain('flags');
    expect(healthScore({ ...fine, flags: 5 }).score).toBe(85);
  });
});
