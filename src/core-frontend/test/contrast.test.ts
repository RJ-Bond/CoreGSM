import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, parseTriplet, WHITE, type RGB } from '../src/colors';

/**
 * WCAG contrast of the design tokens of index.css, read straight from the CSS custom properties.
 * Text tokens must reach 4.5:1 on every surface they are used on; input borders (--field) 3:1.
 */
const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8');

/** `--name: r g b;` declarations of the first block that starts with `selector {` */
function block(selector: string): Record<string, RGB> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`block not found: ${selector}`);
  const end = css.indexOf('}', start);
  const out: Record<string, RGB> = {};
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*(\d+\s+\d+\s+\d+)\s*;/g)) {
    const c = parseTriplet(m[2]);
    if (c) out[m[1]] = c;
  }
  return out;
}

const light = block(':root');
const dark = { ...light, ...block(":root[data-theme='dark']") };
const highLight = { ...light, ...block(":root[data-contrast='high']") };
const highDark = { ...dark, ...block(":root[data-contrast='high']"), ...block(":root[data-theme='dark'][data-contrast='high']") };

const themes: [string, Record<string, RGB>][] = [['light', light], ['dark', dark], ['light + high contrast', highLight], ['dark + high contrast', highDark]];

const TEXT_ON_SURFACES = ['ink', 'mute', 'link', 'ok', 'warn', 'bad'];
const SURFACES = ['card', 'soft', 'page'];
const PILLS: [string, string][] = [['ok', 'okbg'], ['warn', 'warnbg'], ['bad', 'badbg']];
const FILLS = ['brand', 'brand-2', 'badsolid'];

describe('design tokens: contrast', () => {
  it('reads every token it needs', () => {
    for (const [, t] of themes) {
      for (const k of [...TEXT_ON_SURFACES, ...SURFACES, 'okbg', 'warnbg', 'badbg', ...FILLS, 'field', 'seg-on']) expect(t[k], k).toBeDefined();
    }
  });

  for (const [name, t] of themes) {
    describe(name, () => {
      for (const surface of SURFACES) {
        for (const text of TEXT_ON_SURFACES) {
          it(`${text} on ${surface} >= 4.5:1`, () => {
            expect(contrast(t[text], t[surface])).toBeGreaterThanOrEqual(4.5);
          });
        }
      }
      for (const [text, bg] of PILLS) {
        it(`${text} on ${bg} (pill) >= 4.5:1`, () => {
          expect(contrast(t[text], t[bg])).toBeGreaterThanOrEqual(4.5);
        });
      }
      it('ink on the pill backgrounds and on the active tab >= 4.5:1', () => {
        for (const bg of ['okbg', 'warnbg', 'badbg', 'seg-on']) expect(contrast(t.ink, t[bg]), bg).toBeGreaterThanOrEqual(4.5);
      });
      it('mute on the active tab >= 4.5:1', () => {
        expect(contrast(t.mute, t['seg-on'])).toBeGreaterThanOrEqual(4.5);
      });
      for (const fill of FILLS) {
        it(`white on ${fill} (brand-on-fill) >= 4.5:1`, () => {
          expect(contrast(WHITE, t[fill])).toBeGreaterThanOrEqual(4.5);
        });
      }
      for (const surface of SURFACES) {
        it(`field (input border) on ${surface} >= 3:1`, () => {
          expect(contrast(t.field, t[surface])).toBeGreaterThanOrEqual(3);
        });
      }
    });
  }

  it('the system-dark block repeats the explicit dark theme values', () => {
    const m = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{([^}]*)\}/.exec(css);
    expect(m).not.toBeNull();
    const seen: Record<string, RGB> = {};
    for (const x of (m as RegExpExecArray)[1].matchAll(/--([\w-]+):\s*(\d+\s+\d+\s+\d+)\s*;/g)) {
      const c = parseTriplet(x[2]);
      if (c) seen[x[1]] = c;
    }
    const explicit = block(":root[data-theme='dark']");
    for (const [k, v] of Object.entries(explicit)) expect(seen[k], k).toEqual(v);
  });
});
