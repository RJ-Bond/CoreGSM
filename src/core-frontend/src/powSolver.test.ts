import { describe, expect, it } from 'vitest';
import { solve, zeroBits } from './powSolver';

describe('sign-in puzzle', () => {
  it('counts leading zero bits', () => {
    expect(zeroBits(Uint8Array.of(0, 0, 0xff))).toBe(16);
    expect(zeroBits(Uint8Array.of(0, 0x10))).toBe(11);
    expect(zeroBits(Uint8Array.of(0x80))).toBe(0);
  });
  it('finds a nonce that really has the zero bits', async () => {
    const nonce = await solve('test.challenge', 8);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`test.challenge:${nonce}`)));
    expect(zeroBits(h)).toBeGreaterThanOrEqual(8);
  });
});
