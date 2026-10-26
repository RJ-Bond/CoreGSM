import { describe, expect, it } from 'vitest';
import { isFresh } from './achievementsLogic';

const NOW = 1_000_000_000_000;
const a = (over = {}) => ({ id: 'x', earned: true, earnedAt: NOW - 3600_000, ...over });

describe('isFresh', () => {
  it('earned an hour ago and not seen', () => expect(isFresh(a(), [], NOW)).toBe(true));
  it('already seen', () => expect(isFresh(a(), ['x'], NOW)).toBe(false));
  it('earned two days ago', () => expect(isFresh(a({ earnedAt: NOW - 2 * 86_400_000 }), [], NOW)).toBe(false));
  it('not earned or without a date', () => {
    expect(isFresh(a({ earned: false }), [], NOW)).toBe(false);
    expect(isFresh(a({ earnedAt: null }), [], NOW)).toBe(false);
  });
});
