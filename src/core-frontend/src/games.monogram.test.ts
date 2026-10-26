import { describe, expect, it } from 'vitest';
import { gameAbbr, gameColor, monogramColor, monogramOf } from './games';

describe('monogram of an unknown game', () => {
  it('letters from the words', () => {
    expect(monogramOf('space_engineers')).toBe('SE');
    expect(monogramOf('barotrauma')).toBe('BA');
  });
  it('a stable valid colour per name, case-insensitive', () => {
    expect(monogramColor('Barotrauma')).toBe(monogramColor('barotrauma'));
    expect(monogramColor('x')).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('known games keep their own', () => {
    expect(gameColor('minecraft')).toBe('#62b543');
    expect(gameAbbr('minecraft')).toBe('MC');
    expect(gameAbbr('somegame')).toBe('SO');
  });
});
