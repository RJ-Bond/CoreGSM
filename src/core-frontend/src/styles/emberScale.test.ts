import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** the Ember look keeps to one scale of roundings: new rules cannot bring in a 13 px or a 19 px by accident */
const css = readFileSync(new URL('./ember.css', import.meta.url), 'utf8');
const SCALE = new Set([0, 2, 3, 4, 6, 7, 8, 10, 12, 14, 16, 18, 24, 99]);

describe('ember.css scale', () => {
  it('every rounding in pixels is on the scale', () => {
    const bad = [...css.matchAll(/border-radius:\s*(\d+)px/g)].map((m) => Number(m[1])).filter((n) => !SCALE.has(n));
    expect(bad, `off the scale: ${[...new Set(bad)].join(', ')}px; use one of ${[...SCALE].join(', ')}`).toEqual([]);
  });

  it('no font size is written in pixels below the scale of the panel (use the tokens --fs-*)', () => {
    const small = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1])).filter((n) => n < 19);
    expect(small).toEqual([]);
  });
});
