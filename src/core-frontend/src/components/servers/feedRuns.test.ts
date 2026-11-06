import { describe, expect, it } from 'vitest';
import { collapseRuns } from './feedRuns';

const same = (a: { n: string; s: number }, b: { n: string; s: number }) => a.n === b.n && a.s === b.s;

describe('collapseRuns', () => {
  it('joins neighbours that match and keeps the newest and the oldest of a run', () => {
    const r = collapseRuns([{ n: 'a', s: 1 }, { n: 'a', s: 1 }, { n: 'b', s: 1 }, { n: 'a', s: 1 }, { n: 'a', s: 2 }], same);
    expect(r.map((x) => [x.item.n, x.item.s, x.count])).toEqual([['a', 1, 2], ['b', 1, 1], ['a', 1, 1], ['a', 2, 1]]);
  });
  it('is empty for an empty list and keeps single entries as they are', () => {
    expect(collapseRuns([], same)).toEqual([]);
    expect(collapseRuns([{ n: 'a', s: 1 }], same)[0].count).toBe(1);
  });
});
