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
