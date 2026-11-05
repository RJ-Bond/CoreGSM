import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_COOLDOWN, MAX_PROTECTED, cleanCooldown, cleanIds, parseIds } from '../src/community/moderationLogic.js';

test('ids: only well-formed, no duplicates, capped', () => {
  assert.deepEqual(cleanIds(['123456789012345678', '123456789012345678', 'abc', 5, '1']), ['123456789012345678']);
  assert.deepEqual(cleanIds('nope'), []);
  assert.equal(cleanIds(Array.from({ length: 80 }, (_, n) => String(100000000000000000n + BigInt(n)))).length, MAX_PROTECTED);
});

test('cooldown: whole minutes 0..1440, else the default', () => {
  assert.equal(cleanCooldown(0), 0);
  assert.equal(cleanCooldown('15'), 15);
  assert.equal(cleanCooldown(1440), 1440);
  assert.equal(cleanCooldown(1441), DEFAULT_COOLDOWN);
  assert.equal(cleanCooldown(-1), DEFAULT_COOLDOWN);
  assert.equal(cleanCooldown(1.5), DEFAULT_COOLDOWN);
  assert.equal(cleanCooldown(null), DEFAULT_COOLDOWN);
  assert.equal(cleanCooldown(''), DEFAULT_COOLDOWN);
});

test('stored JSON: broken data is an empty list', () => {
  assert.deepEqual(parseIds('["123456789012345678"]'), ['123456789012345678']);
  assert.deepEqual(parseIds('{oops'), []);
  assert.deepEqual(parseIds(null), []);
});
