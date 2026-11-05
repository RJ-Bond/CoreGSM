import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faqAllowed, mentionQuestion } from '../src/faqLogic.js';

test('mention question', () => {
  assert.equal(mentionQuestion('<@123> как зайти на сервер?', '123'), 'как зайти на сервер?');
  assert.equal(mentionQuestion('привет <@!123>  когда  вайп', '123'), 'привет когда вайп');
  assert.equal(mentionQuestion('<@123>', '123'), null);
  assert.equal(mentionQuestion('<@999> как зайти', '123'), null);
});

test('pause per channel', () => {
  const m = new Map<string, number>();
  assert.equal(faqAllowed(m, 'a', 1000), true);
  assert.equal(faqAllowed(m, 'a', 5000), false);
  assert.equal(faqAllowed(m, 'b', 5000), true);
  assert.equal(faqAllowed(m, 'a', 30000), true);
});
