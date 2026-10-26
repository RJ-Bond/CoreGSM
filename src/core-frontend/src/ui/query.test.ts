import { describe, expect, it } from 'vitest';
import { pollEvery } from './query';

describe('pollEvery', () => {
  it('keeps the pause as asked', () => expect(pollEvery(20_000, false)).toBe(20_000));
  it('doubles it in the data-saving mode', () => expect(pollEvery(20_000, true)).toBe(40_000));
  it('does not poll when the pause is 0', () => {
    expect(pollEvery(0, false)).toBe(false);
    expect(pollEvery(0, true)).toBe(false);
  });
});
