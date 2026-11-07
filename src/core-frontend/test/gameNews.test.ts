import { describe, expect, it } from 'vitest';
import { MAX_VISIBLE, colorOpen, isHex, parseNews, unbalanced, validateNews, visibleText, wrapSelection } from '../src/gameNews';

describe('game news preview', () => {
  it('splits the text into coloured, bold and italic pieces', () => {
    const s = parseNews('a <color=#ff0000>red <b>bold</b></color> b');
    expect(s.map((x) => x.text)).toEqual(['a ', 'red ', 'bold', ' b']);
    expect(s[1]).toMatchObject({ color: '#FF0000', bold: false });
    expect(s[2]).toMatchObject({ color: '#FF0000', bold: true });
    expect(s[3]).toMatchObject({ color: null, bold: false });
  });

  it('removes tags the game does not draw, keeping their content', () => {
    expect(parseNews('<size=9>x</size>').map((x) => x.text).join('')).toBe('x');
    expect(parseNews('a < b').map((x) => x.text).join('')).toBe('a  b');
  });

  it('measures and validates the visible length', () => {
    expect(visibleText('<b>abc</b>')).toBe('abc');
    expect(validateNews('')).toBe('empty');
    expect(validateNews('<b></b>')).toBe('empty');
    expect(validateNews('a'.repeat(MAX_VISIBLE + 1))).toBe('long');
    expect(validateNews('ok')).toBeNull();
  });

  it('notices an open tag', () => {
    expect(unbalanced('<color=#ff0000>a')).toBe(true);
    expect(unbalanced('a</b>')).toBe(true);
    expect(unbalanced('<b>a</b>')).toBe(false);
  });

  it('wraps the selection and keeps it selected', () => {
    const r = wrapSelection('hello world', 6, 11, colorOpen('#ff0000'), '</color>');
    expect(r.text).toBe('hello <color=#FF0000>world</color>');
    expect(r.text.slice(r.start, r.end)).toBe('world');
    expect(wrapSelection('x', 1, 1, '<b>', '</b>').text).toBe('x<b>…</b>');
  });

  it('checks a HEX colour', () => {
    expect(isHex('#FFaa00')).toBe(true);
    expect(isHex('#FFF')).toBe(false);
    expect(isHex('red')).toBe(false);
  });
});

import { emptyRule, validateRule } from '../src/gameNews';

describe('automatic announcement form', () => {
  const NOW = Date.UTC(2026, 10, 7, 10, 0);
  const ok = { ...emptyRule(), name: 'Discord', text: 'Заходите в наш Discord' };

  it('accepts a good one', () => {
    expect(validateRule(ok, NOW)).toBeNull();
  });

  it('finds what is missing', () => {
    expect(validateRule({ ...ok, name: ' ' }, NOW)).toBe('name');
    expect(validateRule({ ...ok, text: '<b></b>' }, NOW)).toBe('text');
    expect(validateRule({ ...ok, everyMin: 2 }, NOW)).toBe('every');
    expect(validateRule({ ...ok, everyMin: 20_000 }, NOW)).toBe('every');
    expect(validateRule({ ...ok, kind: 'daily', times: [] }, NOW)).toBe('times');
    expect(validateRule({ ...ok, kind: 'daily', times: ['9:00'] }, NOW)).toBe('times');
    expect(validateRule({ ...ok, kind: 'once', runAt: NOW - 1 }, NOW)).toBe('runAt');
    expect(validateRule({ ...ok, kind: 'once', runAt: NOW + 1 }, NOW)).toBeNull();
    expect(validateRule({ ...ok, activeFrom: 10, activeTo: 5 }, NOW)).toBe('period');
  });
});

import { versionLess } from '../src/gameNews';

describe('plugin version', () => {
  it('compares dotted versions by number', () => {
    expect(versionLess('0.2.0', '0.3.0')).toBe(true);
    expect(versionLess('0.2.0', '0.2.0')).toBe(false);
    expect(versionLess('0.10.0', '0.9.5')).toBe(false);
    expect(versionLess('0.2', '0.2.1')).toBe(true);
  });
  it('treats an unknown version as old', () => {
    expect(versionLess('', '0.2.0')).toBe(true);
    expect(versionLess('x', '0.2.0')).toBe(true);
  });
});

import { fillSample } from '../src/gameNews';

describe('preview variables', () => {
  it('shows sample values', () => {
    expect(fillSample('{server}: {online}/{max} в {time}')).toBe('Мой сервер: 12/40 в 20:00');
    expect(fillSample('{x}')).toBe('{x}');
  });
});

import { greenName } from '../src/gameNews';

describe('green player name in the preview', () => {
  it('draws {name} green in a greeting only', () => {
    expect(fillSample('Привет, {name}', true)).toBe('Привет, <color=#5FD068>Игрок</color>');
    expect(greenName('<color=#FF5555>{name}</color>')).toBe('<color=#FF5555>{name}</color>');
  });
});

import { MAX_BYTES, byteLength, composeLine } from '../src/gameNews';

describe('game chat size and join/leave lines', () => {
  it('counts bytes: Cyrillic is two bytes a letter', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('абв')).toBe(6);
    expect(validateNews('я'.repeat(300))).toBe('long'); // 300 letters but 600 bytes
    expect(validateNews('я'.repeat(200))).toBeNull(); // 400 bytes
    expect(MAX_BYTES).toBe(500);
  });
  it('builds a join line with a coloured name', () => {
    expect(composeLine('* Игрок {name} вошёл', '#b86bff', '#5fd068')).toBe('<color=#5FD068>* Игрок <color=#B86BFF>{name}</color> вошёл</color>');
  });
});

import { VARIABLES, WELCOME_STYLES, WELCOME_VARIABLES } from '../src/gameNews';

describe('welcome styles and variables', () => {
  it('every ready style is a valid message with known variables', () => {
    for (const st of WELCOME_STYLES) {
      expect(validateNews(st.text)).toBeNull();
      expect(validateNews(st.newText)).toBeNull();
      const names = [...(st.text + st.newText).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const n of names) expect([...WELCOME_VARIABLES] as string[]).toContain(n);
    }
  });
  it('the preview fills all variables and the greeting adds a green name', () => {
    expect(VARIABLES).toHaveLength(9);
    expect(fillSample('{greeting}! {restart} {wipe} {discord} {tip}')).toBe('Добрый вечер! 3 ч 20 мин 12.11, 20:00 discord.gg/coregsm Сохраняйтесь у сундука.');
    expect(fillSample('{greeting}, {name}', true)).toBe('Добрый вечер, <color=#5FD068>Игрок</color>');
  });
});
