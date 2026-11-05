import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS } from '../src/commands.js';
import { BULK_MAX_AGE_MS, CONFIRM_TTL_MS, MAX_COUNT, clearId, isExpired, messages, normalizeCount, parseClearId, plural, sortPage, stopId } from '../src/clearLogic.js';
import { CLEAR_COMMANDS } from '../src/clear.js';

test('/clear is registered once, is hidden from those who cannot manage messages and works only on a server', () => {
  assert.equal(COMMANDS.filter((c) => c.name === 'clear').length, 1);
  const c = CLEAR_COMMANDS[0]!;
  assert.equal(c.dm_permission, false);
  assert.equal(c.default_member_permissions, String(1n << 13n));
});

test('button ids round-trip, stay short and reject foreign ids', () => {
  const id = clearId('go', '123456789012345678', 250, 1_800_000_000_000);
  assert.ok(id.length <= 100);
  assert.deepEqual(parseClearId(id), { action: 'go', userId: '123456789012345678', count: 250, at: 1_800_000_000_000 });
  assert.equal(parseClearId('clear:go:abc:1:1'), null);
  assert.equal(parseClearId('help:play'), null);
  assert.equal(parseClearId(stopId('123456789012345678'))?.action, 'stop');
});

test('the confirmation expires', () => {
  assert.equal(isExpired(1000, 1000 + CONFIRM_TTL_MS), false);
  assert.equal(isExpired(1000, 1001 + CONFIRM_TTL_MS), true);
  assert.equal(isExpired(5000, 1000), true);
});

test('count: a whole number up to the limit, anything else means all', () => {
  assert.equal(normalizeCount(null), 0);
  assert.equal(normalizeCount(0), 0);
  assert.equal(normalizeCount(-3), 0);
  assert.equal(normalizeCount(2.5), 0);
  assert.equal(normalizeCount(50), 50);
  assert.equal(normalizeCount(10 ** 9), MAX_COUNT);
});

test('sortPage keeps pinned and old messages and respects the room', () => {
  const now = 10 ** 12;
  const m = (id: string, age: number, pinned = false) => ({ id, createdTimestamp: now - age, pinned });
  const r = sortPage([m('1', 1000), m('2', 2000, true), m('3', 3000), m('4', BULK_MAX_AGE_MS + 1), m('5', BULK_MAX_AGE_MS + 5, true)], now, Infinity);
  assert.deepEqual(r, { del: ['1', '3'], pinned: 2, old: 1 });
  assert.deepEqual(sortPage([m('1', 1), m('2', 2), m('3', 3)], now, 2).del, ['1', '2']);
});

test('Russian plurals', () => {
  assert.equal(messages(1), '1 сообщение');
  assert.equal(messages(2), '2 сообщения');
  assert.equal(messages(5), '5 сообщений');
  assert.equal(messages(11), '11 сообщений');
  assert.equal(messages(21), '21 сообщение');
  assert.equal(plural(112, ['а', 'б', 'в']), '112 в');
});
