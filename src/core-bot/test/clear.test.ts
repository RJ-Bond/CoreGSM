import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS } from '../src/commands.js';
import { BULK_MAX_AGE_MS, CONFIRM_TTL_MS, MAX_COUNT, clearId, cooldownLeft, estimate, etaText, expectedTotal, isExpired, messages, normalizeCount, parseClearId, pickLine, plural, readModeration, sortPage, speedText, stopId, waitText } from '../src/clearLogic.js';
import { CLEAR_COMMANDS } from '../src/clear.js';

test('/clear is registered once, is hidden from non-administrators and works only on a server', () => {
  assert.equal(COMMANDS.filter((c) => c.name === 'clear').length, 1);
  const c = CLEAR_COMMANDS[0]!;
  assert.equal(c.dm_permission, false);
  assert.equal(c.default_member_permissions, String(1n << 3n));
  assert.deepEqual(c.options.map((o) => o.name), ['count', 'user']);
});

test('button ids round-trip, stay short and reject foreign ids', () => {
  const st = { count: 250, pinned: true, target: '123456789012345678', old: true };
  const id = clearId('go', '123456789012345678', st, 1_800_000_000_000);
  assert.ok(id.length <= 100);
  assert.deepEqual(parseClearId(id), { action: 'go', userId: '123456789012345678', ...st, at: 1_800_000_000_000 });
  assert.deepEqual(parseClearId(clearId('set', '1234', { count: 0, pinned: false, target: '', old: false }, 5)), { action: 'set', userId: '1234', count: 0, pinned: false, target: '', old: false, at: 5 });
  assert.equal(parseClearId('clear:go:abc:1:1:0:0'), null);
  assert.equal(parseClearId('clear:go:12:1:1'), null);
  assert.equal(parseClearId('help:play'), null);
  assert.equal(parseClearId(stopId('123456789012345678'))?.action, 'stop');
  assert.equal(parseClearId(stopId('123456789012345678'))?.userId, '123456789012345678');
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

const now = 10 ** 12;
const m = (id: string, age: number, o: { pinned?: boolean; by?: string } = {}) => ({ id, createdTimestamp: now - age, pinned: o.pinned ?? false, authorId: o.by ?? 'a' });
const keep = { pinned: false, target: '' };

test('sortPage keeps pinned and old messages and respects the room', () => {
  const page = [m('1', 1000), m('2', 2000, { pinned: true }), m('3', 3000), m('4', BULK_MAX_AGE_MS + 1), m('5', BULK_MAX_AGE_MS + 5, { pinned: true })];
  assert.deepEqual(sortPage(page, now, keep, Infinity), { del: ['1', '3'], slow: [], pinned: 2, old: 1 });
  assert.deepEqual(sortPage([m('1', 1), m('2', 2), m('3', 3)], now, keep, 2).del, ['1', '2']);
});

test('sortPage: pinned can be deleted on request, a target limits it to one member', () => {
  const page = [m('1', 1000), m('2', 2000, { pinned: true }), m('3', 3000, { by: 'b' }), m('4', BULK_MAX_AGE_MS + 1)];
  assert.deepEqual(sortPage(page, now, { pinned: true, target: '' }, Infinity), { del: ['1', '2', '3'], slow: [], pinned: 0, old: 1 });
  assert.deepEqual(sortPage(page, now, { pinned: false, target: 'b' }, Infinity), { del: ['3'], slow: [], pinned: 0, old: 0 });
});

test('old messages are deleted one by one only on request, and count against the room', () => {
  const page = [m('1', 1000), m('2', BULK_MAX_AGE_MS + 1), m('3', BULK_MAX_AGE_MS + 2), m('4', BULK_MAX_AGE_MS + 3, { pinned: true })];
  assert.deepEqual(sortPage(page, now, { pinned: false, target: '', old: true }, Infinity), { del: ['1'], slow: ['2', '3'], pinned: 1, old: 0 });
  assert.deepEqual(sortPage(page, now, { pinned: false, target: '', old: true }, 2), { del: ['1'], slow: ['2'], pinned: 1, old: 1 });
  const e = estimate(page, true, now, { count: 0, pinned: false, target: '', old: true });
  assert.deepEqual([e.deletable, e.slow, e.old], [3, 2, 0]);
});

test('estimate and the number the progress counts to', () => {
  const list = [m('1', 1), m('2', 2), m('3', 3, { pinned: true }), m('4', BULK_MAX_AGE_MS + 9)];
  const e = estimate(list, true, now, { count: 0, pinned: false, target: '', old: false });
  assert.deepEqual(e, { scanned: 4, complete: true, deletable: 2, slow: 0, pinned: 1, old: 1 });
  assert.equal(expectedTotal(e, 0), 2);
  assert.equal(expectedTotal({ ...e, complete: false }, 0), 0);
  assert.equal(expectedTotal({ ...e, complete: false }, 2), 2);
  assert.equal(expectedTotal(null, 5), 0);
  assert.equal(estimate(list, true, now, { count: 1, pinned: false, target: '', old: false }).deletable, 1);
});

test('speed, time left, pause', () => {
  assert.equal(speedText(0, 5000), '');
  assert.equal(speedText(200, 2000), '100 сообщ./с');
  assert.equal(speedText(5, 2000), '2,5 сообщ./с');
  assert.equal(etaText(100, 300, 10_000), '≈ 20 с');
  assert.equal(etaText(100, 100, 10_000), '');
  assert.equal(etaText(0, 100, 10_000), '');
  assert.equal(cooldownLeft(undefined, 5, now), 0);
  assert.equal(cooldownLeft(now - 60_000, 0, now), 0);
  assert.equal(cooldownLeft(now - 60_000, 5, now), 4 * 60_000);
  assert.equal(cooldownLeft(now - 10 * 60_000, 5, now), 0);
  assert.equal(waitText(4 * 60_000), '4 мин');
  assert.equal(waitText(40_000), '40 с');
});

test('the panel answer is checked, the notice line is always there', () => {
  assert.deepEqual(readModeration({ enabled: true, logChannelId: '123456789012345678', protectedChannels: ['1'], cooldown: 2 }), { enabled: true, logChannelId: '123456789012345678', protectedChannels: ['1'], cooldown: 2 });
  assert.equal(readModeration({ enabled: 'yes' }), null);
  assert.equal(readModeration(null), null);
  assert.equal(readModeration({ enabled: false, logChannelId: 'x', protectedChannels: [], cooldown: -1 })?.logChannelId, '');
  for (const r of [0, 0.5, 0.999, 1, -1]) assert.ok(pickLine(r).length > 5);
});

test('Russian plurals', () => {
  assert.equal(messages(1), '1 сообщение');
  assert.equal(messages(2), '2 сообщения');
  assert.equal(messages(5), '5 сообщений');
  assert.equal(messages(11), '11 сообщений');
  assert.equal(messages(21), '21 сообщение');
  assert.equal(plural(112, ['а', 'б', 'в']), '112 в');
});
