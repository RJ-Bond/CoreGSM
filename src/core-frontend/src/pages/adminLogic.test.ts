import { describe, expect, it } from 'vitest';
import { delta, dayKey, healthScore, type HealthInput } from './adminLogic';

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
