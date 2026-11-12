import { describe, expect, it } from 'vitest';
import { lonelyTile } from './gridLogic';

describe('the tile that closes an unfinished row', () => {
  it('takes the empty places of the last row', () => {
    expect(lonelyTile([1, 2, 3], [], 3)).toBeNull();
    expect(lonelyTile([1, 2, 3, 4], [], 3)).toEqual({ id: 4, span: 3 });
    expect(lonelyTile([1, 2, 3, 4, 5], [], 3)).toEqual({ id: 5, span: 2 });
    expect(lonelyTile([1, 2, 3], [], 2)).toEqual({ id: 3, span: 2 });
  });
  it('does nothing in one column, and counts the favourites as a group of their own', () => {
    expect(lonelyTile([1, 2, 3, 4], [], 1)).toBeNull();
    expect(lonelyTile([1, 2, 3, 4, 5], [1, 2], 3)).toBeNull();
    expect(lonelyTile([1, 2, 3, 4, 5, 6], [1], 3)).toEqual({ id: 6, span: 2 });
  });
});
