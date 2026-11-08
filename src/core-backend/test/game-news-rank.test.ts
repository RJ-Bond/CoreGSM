import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankLine } from '../src/gamenews/gameNewsRank.ts';

const T = '* {name}, ваш ранг: {rank} · {hours} ч{next}';

test('rank line: the rank, the hours and the distance to the next rank', () => {
  assert.equal(rankLine(T, 'Bob', 42.7), '* Bob, ваш ранг: Охотник на кровь · 42 ч · до «Страж замка» ещё 28 ч');
  assert.equal(rankLine(T, 'Bob', 2.55), '* Bob, ваш ранг: Пробуждённый · 2.5 ч · до «Ночной скиталец» ещё 8 ч');
});

test('rank line: the top rank has no next one, tags in a nickname are removed', () => {
  assert.match(rankLine(T, 'Bob', 2000), /Первородный · 2000 ч · высший ранг$/);
  assert.equal(rankLine('{name}', '<b>Bob</b>', 1), 'bBob/b');
});
