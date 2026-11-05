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

import { DEFAULT_REASONS, cleanInt, cleanReasons, expiresAt, ladderFor, parseReasons, scaleOf } from '../src/community/moderationLogic.js';

test('reasons: trimmed, unique, short, at most 15; defaults only before anything is saved', () => {
  assert.deepEqual(cleanReasons([' Спам ', 'Спам', '', 5, 'А  Б']), ['Спам', 'А Б']);
  assert.equal(cleanReasons(['я'.repeat(300)])[0]!.length, 100);
  assert.equal(cleanReasons(Array.from({ length: 40 }, (_, n) => `r${n}`)).length, 15);
  assert.deepEqual(parseReasons(null), DEFAULT_REASONS);
  assert.deepEqual(parseReasons('[]'), []);
  assert.deepEqual(parseReasons('{oops'), DEFAULT_REASONS);
});

test('numbers of the panel are checked', () => {
  assert.equal(cleanInt('30', 0, 3650, 7), 30);
  assert.equal(cleanInt(-1, 0, 3650, 7), 7);
  assert.equal(cleanInt(1.5, 0, 3650, 7), 7);
  assert.equal(cleanInt(null, 0, 3650, 7), 7);
});

test('the ladder: a kick beats a timeout, nothing while it is off, the scale follows the highest step', () => {
  const l = { muteAt: 3, muteMinutes: 60, kickAt: 5 };
  assert.equal(ladderFor(2, l), null);
  assert.deepEqual(ladderFor(3, l), { action: 'timeout', minutes: 60 });
  assert.deepEqual(ladderFor(4, l), { action: 'timeout', minutes: 60 });
  assert.deepEqual(ladderFor(5, l), { action: 'kick' });
  assert.equal(ladderFor(99, { muteAt: 0, muteMinutes: 60, kickAt: 0 }), null);
  assert.equal(scaleOf(l), 5);
  assert.equal(scaleOf({ muteAt: 8, muteMinutes: 60, kickAt: 0 }), 8);
  assert.equal(scaleOf({ muteAt: 0, muteMinutes: 60, kickAt: 0 }), 5);
});

test('a warning expires after the chosen days, never when 0', () => {
  assert.equal(expiresAt(1000, 0), null);
  assert.equal(expiresAt(1000, 1), 1000 + 86_400_000);
});
