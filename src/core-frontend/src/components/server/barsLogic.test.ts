import { describe, expect, it } from 'vitest';
import { barCount, bucketPeaks, highestBar } from './barsLogic';

const H = 3_600_000;

describe('the bars of the players chart', () => {
  it('has a bar an hour for a day, and more bars for longer periods', () => {
    expect(barCount(24)).toBe(24);
    expect(barCount(168)).toBe(28);
    expect(barCount(720)).toBe(30);
  });
  it('takes the peak of every bucket and ignores offline samples and samples outside of the period', () => {
    const now = 100 * H;
    const bars = bucketPeaks([
      { ts: now - 23.5 * H, players: 5 },
      { ts: now - 23.2 * H, players: 9 },
      { ts: now - 23.1 * H, players: 20, online: false },
      { ts: now - 0.5 * H, players: 14 },
      { ts: now - 30 * H, players: 99 },
    ], 24, now);
    expect(bars).toHaveLength(24);
    expect(bars[0].peak).toBe(9);
    expect(bars[23].peak).toBe(14);
    expect(bars.filter((b) => b.peak != null)).toHaveLength(2);
  });
  it('finds the highest bar, the latest one on a tie, and none without data', () => {
    expect(highestBar([{ from: 0, to: 1, peak: 3 }, { from: 1, to: 2, peak: 8 }, { from: 2, to: 3, peak: 8 }, { from: 3, to: 4, peak: null }])).toBe(2);
    expect(highestBar([{ from: 0, to: 1, peak: null }])).toBe(-1);
  });
});
