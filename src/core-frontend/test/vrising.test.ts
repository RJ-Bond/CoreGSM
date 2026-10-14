import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VR_RANKS, nextRank, rankById, rankForHours, rankProgress } from '../src/vrisingRanks';

describe('V Rising rank ladder', () => {
  it('picks the rank at the thresholds', () => {
    expect(rankForHours(0).id).toBe('awakened');
    expect(rankForHours(4.9).id).toBe('awakened');
    expect(rankForHours(5).id).toBe('wanderer');
    expect(rankForHours(100).id).toBe('baron');
    expect(rankForHours(10_000).id).toBe('progenitor');
  });
  it('next rank and progress', () => {
    expect(nextRank(0)?.id).toBe('wanderer');
    expect(nextRank(800)).toBeNull();
    expect(rankProgress(2.5)).toBe(0.5);
    expect(rankProgress(35)).toBe(0.5);
    expect(rankProgress(801)).toBe(1);
  });
  it('looks ranks up by id', () => {
    expect(rankById('lord')?.minHours).toBe(200);
    expect(rankById('nope')).toBeUndefined();
    expect(rankById(undefined)).toBeUndefined();
  });
  it('matches the backend ladder (ids, hours, colours, images)', () => {
    const src = readFileSync(new URL('../../core-backend/src/ranks.ts', import.meta.url), 'utf8');
    const rows = [...src.matchAll(/id: '([a-z]+)', name: '[^']+', minHours: (\d+), color: '(#[0-9a-f]{6})', image: '([^']+)'/g)].map((m) => ({ id: m[1], minHours: Number(m[2]), color: m[3], image: m[4] }));
    expect(rows).toEqual(VR_RANKS.map((r) => ({ id: r.id, minHours: r.minHours, color: r.color, image: r.image })));
  });
});
