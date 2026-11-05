import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchFaq, normalize, parseKeywords, type FaqEntry } from '../src/community/faqLogic.js';

const list: FaqEntry[] = [
  { id: 1, title: 'Адрес', keywords: ['адрес', 'ip', 'как зайти'], answer: 'a' },
  { id: 2, title: 'Вайп', keywords: ['вайп', 'когда вайп', 'wipe'], answer: 'b' },
  { id: 3, title: 'Правила', keywords: ['правила'], answer: 'c' },
];

test('normalize', () => {
  assert.equal(normalize('  Ёлка, ПРИВЕТ!! '), 'елка привет');
});

test('keywords: split, clean, distinct, capped', () => {
  assert.deepEqual(parseKeywords('Адрес, ip;\n Как зайти? , адрес, x'), ['адрес', 'ip', 'как зайти']);
  assert.equal(parseKeywords(Array.from({ length: 40 }, (_, i) => `слово${i}`)).length, 20);
  assert.deepEqual(parseKeywords('x'.repeat(41)), []);
});

test('match: whole words and phrases, the better entry wins', () => {
  assert.equal(matchFaq('Какой адрес сервера?', list)?.id, 1);
  assert.equal(matchFaq('когда будет вайп', list)?.id, 2, 'two keywords beat one');
  assert.equal(matchFaq('как зайти и какие правила', list)?.id, 1, 'the longer keyword wins a tie');
  assert.equal(matchFaq('ipad', list), null, 'a keyword inside another word does not count');
  assert.equal(matchFaq('привет', list), null);
  assert.equal(matchFaq('ab', list), null);
});
