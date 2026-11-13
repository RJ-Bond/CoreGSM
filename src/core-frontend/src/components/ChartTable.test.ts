import { describe, expect, it } from 'vitest';
import { bucketFor, bucketRows } from './ChartTable';

describe('the table under a chart', () => {
  const H = 3_600_000;
  it('takes the highest value of an hour, or the mean, and leaves the hours without data out', () => {
    const pts = [{ ts: 0, value: 3 }, { ts: 10 * 60_000, value: 9 }, { ts: 20 * 60_000, value: null }, { ts: 2 * H, value: 4 }, { ts: 2 * H + 1000, value: 6 }];
    expect(bucketRows(pts, H)).toEqual([{ from: 0, value: 9 }, { from: 2 * H, value: 6 }]);
    expect(bucketRows(pts, H, 'mean')).toEqual([{ from: 0, value: 6 }, { from: 2 * H, value: 5 }]);
    expect(bucketRows([], H)).toEqual([]);
  });
  it('picks an hour, six hours or a day by the period', () => {
    expect([bucketFor(24), bucketFor(168), bucketFor(720)]).toEqual([H, 6 * H, 24 * H]);
  });
});
