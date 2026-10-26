import { describe, expect, it } from 'vitest';
import { buildChart, nearestIndex, shareOf, stateSegments, thin } from '../src/healthChart';

describe('buildChart', () => {
  it('is empty without data', () => {
    expect(buildChart([null, null], 100, 50).empty).toBe(true);
  });
  it('keeps the threshold inside the chart and above a lower line', () => {
    const c = buildChart([1000, 2000, 1500], 100, 50, { limit: 5000 });
    expect(c.limitY).toBeDefined();
    const line = buildChart([1000, 6000], 100, 50, { limit: 5000 });
    expect(line.limitY!).toBeGreaterThan(3);
    expect(c.limitY!).toBeLessThan(buildChart([1000, 2000], 100, 50).limitY ?? 1e9);
  });
  it('breaks the line at a gap', () => {
    const c = buildChart([1, 2, null, 3, 4], 100, 50);
    expect((c.path.match(/M/g) ?? []).length).toBe(2);
  });
  it('floor keeps the bottom at the data minimum', () => {
    const flat = buildChart([100, 101], 100, 50, { floor: true });
    const zero = buildChart([100, 101], 100, 50);
    expect(flat.path).not.toBe(zero.path);
  });
});

describe('stateSegments', () => {
  const s = [
    { ts: 0, botState: 'ready' }, { ts: 10, botState: 'ready' }, { ts: 20, botState: 'offline' }, { ts: 30, botState: 'ready' },
  ];
  it('merges runs and lasts until the next sample', () => {
    const segs = stateSegments(s, 40);
    expect(segs).toEqual([{ from: 0, to: 20, state: 'ready' }, { from: 20, to: 30, state: 'offline' }, { from: 30, to: 40, state: 'ready' }]);
  });
  it('counts the share of good time', () => {
    const share = shareOf(stateSegments(s, 40), (x) => x !== 'offline');
    expect(share).toBeCloseTo(30 / 40);
  });
  it('is 1 without samples', () => {
    expect(shareOf([], () => true)).toBe(1);
  });
});

describe('thin', () => {
  it('keeps short series as they are', () => {
    const p = [{ ts: 1, v: 1 }, { ts: 2, v: 2 }];
    expect(thin(p, 10)).toBe(p);
  });
  it('averages buckets and keeps the middle time', () => {
    const p = Array.from({ length: 100 }, (_, i) => ({ ts: i * 10, v: i }));
    const t = thin(p, 10);
    expect(t).toHaveLength(10);
    expect(t[0].v).toBeCloseTo(4.5);
    expect(t[0].ts).toBe(50);
  });
  it('turns an all-gap bucket into a gap', () => {
    const p = [...Array.from({ length: 10 }, (_, i) => ({ ts: i, v: null as number | null })), ...Array.from({ length: 10 }, (_, i) => ({ ts: 10 + i, v: 5 }))];
    const t = thin(p, 2);
    expect(t[0].v).toBeNull();
    expect(t[1].v).toBe(5);
  });
});

describe('nearestIndex', () => {
  it('maps a share of the width to a point', () => {
    expect(nearestIndex(0, 11)).toBe(0);
    expect(nearestIndex(0.5, 11)).toBe(5);
    expect(nearestIndex(1, 11)).toBe(10);
    expect(nearestIndex(2, 11)).toBe(10);
    expect(nearestIndex(0.3, 1)).toBe(0);
  });
});
