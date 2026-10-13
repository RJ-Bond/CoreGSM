import { describe, expect, it } from 'vitest';
import { BLACK, WHITE, brandVars, contrast, ensureContrast, parseHex, parseTriplet, type RGB } from '../src/colors';
import { blank, fromPayload, toPayload, LIMITS, payloadKey } from '../src/components/news/model';
import { normalizePrefs } from '../src/i18n';
import ru from '../src/locales/ru';
import en from '../src/locales/en';

describe('colors', () => {
  it('parses hex and triplets', () => {
    expect(parseHex('#ff0000')).toEqual([255, 0, 0]);
    expect(parseHex('nonsense')).toBeNull();
    expect(parseTriplet('12 34 56')).toEqual([12, 34, 56]);
  });

  it('computes WCAG contrast', () => {
    expect(contrast(BLACK, WHITE)).toBeCloseTo(21, 0);
    expect(contrast(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it('darkens a colour until it reaches the minimum contrast', () => {
    const c = ensureContrast([250, 220, 60], [WHITE], 4.5, 'darken');
    expect(contrast(c, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps white text on the brand fill and the link readable, for any brand colour, in both themes', () => {
    const card: Record<'light' | 'dark', RGB> = { light: WHITE, dark: [23, 24, 29] };
    const soft: Record<'light' | 'dark', RGB> = { light: [238, 240, 244], dark: [33, 34, 41] };
    for (const color of ['#4f46e5', '#f5b01e', '#7c3aed', '#ffffff', '#000000', '#22c55e', '#ff0066']) {
      for (const theme of ['light', 'dark'] as const) {
        const v = brandVars(color, undefined, theme === 'dark', card[theme], soft[theme]);
        expect(contrast(WHITE, v.fill), `${color} fill (${theme})`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v.link, card[theme]), `${color} link on card (${theme})`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v.link, soft[theme]), `${color} link on soft (${theme})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('news editor model', () => {
  it('round-trips a draft through the API payload', () => {
    const d = blank('123456789012345678');
    d.content = 'hello';
    d.embeds[0]!.title = 'Title';
    d.embeds[0]!.description = 'Body';
    const p = toPayload(d);
    const back = fromPayload(p, d.channelId);
    expect(payloadKey(toPayload(back))).toBe(payloadKey(p));
  });

  it('keeps Discord limits in one place', () => {
    expect(LIMITS.total).toBe(6000);
  });
});

describe('i18n', () => {
  it('has every Russian key in English and no empty strings', () => {
    const ruKeys = Object.keys(ru).sort();
    expect(Object.keys(en).sort()).toEqual(ruKeys);
    for (const k of ruKeys) {
      expect((en as Record<string, string>)[k], k).toBeTruthy();
      expect((ru as Record<string, string>)[k], k).toBeTruthy();
    }
  });

  it('uses the same placeholders in both languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).filter((v, i, a) => a.indexOf(v) === i).sort().join(',');
    for (const k of Object.keys(ru)) {
      expect(ph((en as Record<string, string>)[k]!), k).toBe(ph((ru as Record<string, string>)[k]!));
    }
  });

  it('normalises preferences', () => {
    const p = normalizePrefs({ lang: 'xx', timeFormat: '12', dateFormat: 'nope', timezone: 5 });
    expect(p.lang).toBe('ru');
    expect(p.timeFormat).toBe('12');
    expect(p.dateFormat).toBe('dmy');
    expect(p.timezone).toBe('');
  });
});
