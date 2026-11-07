import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkNews, cleanNews, MAX_VISIBLE, visibleText } from '../src/gamenews/gameNewsLogic.ts';

describe('game news text', () => {
  it('keeps colour, bold and italic tags', () => {
    assert.equal(cleanNews('<color=#ff0000>Вайп</color> <b>завтра</b>'), '<color=#ff0000>Вайп</color> <b>завтра</b>');
  });

  it('cuts out tags that are not allowed and stray angle brackets', () => {
    assert.equal(cleanNews('<size=500>огромно</size> a < b'), 'огромно a b');
    assert.equal(cleanNews('<color=red>x</color>'), 'x');
  });

  it('closes tags left open and drops closing tags without an opening one', () => {
    assert.equal(cleanNews('<color=#00ff00><b>привет'), '<color=#00ff00><b>привет</b></color>');
    assert.equal(cleanNews('привет</b>'), 'привет');
  });

  it('turns line breaks into spaces and removes control characters', () => {
    assert.equal(cleanNews('a\nb\r\nc\u0000d'), 'a b cd');
  });

  it('measures the length without tags', () => {
    assert.equal(visibleText('<color=#ff0000>abc</color>'), 'abc');
    assert.equal(checkNews('<color=#ff0000>' + 'a'.repeat(MAX_VISIBLE) + '</color>').ok, true);
    assert.equal(checkNews('a'.repeat(MAX_VISIBLE + 1)).ok, false);
  });

  it('refuses an empty message and a non-string', () => {
    assert.equal(checkNews('   ').ok, false);
    assert.equal(checkNews('<b></b>').ok, false);
    assert.equal(checkNews(42).ok, false);
  });
});
