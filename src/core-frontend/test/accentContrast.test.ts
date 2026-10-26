import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandVars, contrast, parseTriplet, WHITE, type RGB } from '../src/colors';
import { GAMES } from '../src/games';

/**
 * Every accent the panel can paint (the colour of each game, which covers «V Rising», «Icarus» and «auto»,
 * plus a few community brand colours) must keep, in both themes:
 *  - white text on the brand fill and on the gradient end >= 4.5:1,
 *  - brand-coloured text (link) >= 4.5:1 on the card and on the soft surfaces,
 * measured on the real surface tokens of index.css, not on made-up greys.
 */
const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8');

function tokens(selector: string): Record<string, RGB> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`block not found: ${selector}`);
  const out: Record<string, RGB> = {};
  for (const m of css.slice(start, css.indexOf('}', start)).matchAll(/--([\w-]+):\s*(\d+\s+\d+\s+\d+)\s*;/g)) {
    const c = parseTriplet(m[2]);
    if (c) out[m[1]] = c;
  }
  return out;
}

const light = tokens(':root');
const dark = { ...light, ...tokens(":root[data-theme='dark']") };
const THEMES: ['light' | 'dark', Record<string, RGB>][] = [['light', light], ['dark', dark]];

const ACCENTS: [string, string][] = [
  ...GAMES.map((g) => [g.label, g.color] as [string, string]),
  ['brand: default', '#4f46e5'], ['brand: yellow', '#ffe14d'], ['brand: white', '#ffffff'], ['brand: black', '#000000'],
];

describe('accent presets: contrast in both themes', () => {
  it('reads the surfaces it measures against', () => {
    for (const [, t] of THEMES) for (const k of ['card', 'soft']) expect(t[k], k).toBeDefined();
  });

  for (const [theme, t] of THEMES) {
    it(`keeps every accent readable (${theme})`, () => {
      const card = t.card!;
      const soft = t.soft!;
      const raised = t.raised ?? card;
      // the same choice as paintBrand: the worst surface for the text colour of the theme
      const worst = (a: RGB, b: RGB) => ((a[0] + a[1] + a[2] > b[0] + b[1] + b[2]) === (theme === 'dark') ? a : b);
      const bad: string[] = [];
      for (const [name, color] of ACCENTS) {
        const v = brandVars(color, undefined, theme === 'dark', card, worst(raised, soft));
        const checks: [string, number][] = [
          ['white on fill', contrast(WHITE, v.fill)],
          ['white on gradient end', contrast(WHITE, v.end)],
          ['link on card', contrast(v.link, card)],
          ['link on soft', contrast(v.link, soft)],
          ['link on raised', contrast(v.link, raised)],
        ];
        for (const [what, ratio] of checks) if (ratio < 4.5) bad.push(`${name}: ${what} ${ratio.toFixed(2)}`);
        // the hover shade must not lose the white text either
        if (contrast(WHITE, v.hover) < 4.5) bad.push(`${name}: white on hover ${contrast(WHITE, v.hover).toFixed(2)}`);
      }
      expect(bad).toEqual([]);
    });
  }
});
