import { describe, expect, it } from 'vitest';
import { downsample, trendPct } from './serverLogic';

describe('trendPct', () => {
  it('compares the last third with the first third', () => {
    expect(trendPct([10, 10, 12, 14, 15, 20])).toBe(75);
    expect(trendPct([20, 20, 15, 12, 10, 10])).toBe(-50);
  });
  it('has no answer for short series or an empty base', () => {
    expect(trendPct([1, 2, 3])).toBeNull();
    expect(trendPct([0, 0, 0, 0, 5, 5])).toBeNull();
  });
});

describe('downsample', () => {
  it('keeps short series and thins long ones keeping both ends', () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
    const d = downsample(Array.from({ length: 100 }, (_, i) => i), 10);
    expect(d).toHaveLength(10);
    expect(d[0]).toBe(0);
    expect(d[9]).toBe(99);
  });
});
