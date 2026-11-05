import { describe, expect, it } from 'vitest';
import { rgbTokenToHex } from '../src/ui/theme';

describe('rgbTokenToHex', () => {
  it('turns the page colour token into a hex colour', () => {
    expect(rgbTokenToHex('243 244 248')).toBe('#f3f4f8');
    expect(rgbTokenToHex(' 9 10 14 ')).toBe('#090a0e');
    expect(rgbTokenToHex('0 0 0')).toBe('#000000');
  });
  it('refuses anything else', () => {
    expect(rgbTokenToHex('')).toBeNull();
    expect(rgbTokenToHex('300 1 1')).toBeNull();
    expect(rgbTokenToHex('rgb(1 2 3)')).toBeNull();
  });
});
