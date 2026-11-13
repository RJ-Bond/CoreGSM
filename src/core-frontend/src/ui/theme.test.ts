import { describe, expect, it } from 'vitest';
import { isNightHour, NIGHT_FROM, NIGHT_TO } from './theme';

describe('the theme of the admin area by the clock', () => {
  it('is dark in the evening and at night and light by day', () => {
    expect(NIGHT_FROM).toBe(20);
    expect(NIGHT_TO).toBe(7);
    for (const h of [20, 21, 23, 0, 3, 6]) expect(isNightHour(h), `${h}:00`).toBe(true);
    for (const h of [7, 8, 12, 17, 19]) expect(isNightHour(h), `${h}:00`).toBe(false);
  });
});
