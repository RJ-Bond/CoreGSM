import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS } from '../src/commands.js';
import { PUNISH_COMMANDS } from '../src/punish.js';
import { BAN_PAGE, MAX_REASON, banLine, pageId, paginate, parsePageId, auditReason, cleanReason, daysText, deleteDays, deleteSeconds, dmText, escalationHint, idFromInput, isStale, newToken, parsePunishId, punishId, standingProblem, PUNISH_TTL_MS } from '../src/punishLogic.js';

test('/ban /unban /kick /warn are registered once, for administrators only, and fit the limits of Discord', () => {
  for (const name of ['ban', 'unban', 'kick', 'warn']) assert.equal(COMMANDS.filter((c) => c.name === name).length, 1, name);
  for (const c of PUNISH_COMMANDS) {
    assert.equal(c.dm_permission, false);
    assert.equal(c.default_member_permissions, String(1n << 3n));
    assert.ok(c.description.length <= 100);
    for (const d of Object.values(c.description_localizations)) assert.ok(d.length <= 100, d);
    for (const o of c.options) {
      assert.ok(o.description.length <= 100, o.description);
      for (const d of Object.values(o.description_localizations)) assert.ok(d.length <= 100, d);
    }
    // Discord wants the required options first
    const flags = c.options.map((o) => !!o.required);
    assert.deepEqual(flags, [...flags].sort((a, b) => Number(b) - Number(a)), c.name);
  }
});

test('the reason is required for a ban, a kick and a warning, optional for an unban', () => {
  const required = (name: string) => PUNISH_COMMANDS.find((c) => c.name === name)!.options.find((o) => o.name === 'reason')!.required;
  assert.equal(required('ban'), true);
  assert.equal(required('kick'), true);
  assert.equal(required('warn'), true);
  assert.equal(required('unban'), false);
});

const st = { targetId: '10', modId: '20', botId: '30', ownerId: '40', inGuild: true, targetPos: 1, modPos: 5, botPos: 8 };

test('who may be punished by whom', () => {
  assert.equal(standingProblem(st), null);
  assert.match(standingProblem({ ...st, targetId: '20' })!, /самому себе/);
  assert.match(standingProblem({ ...st, targetId: '30' })!, /боту/);
  assert.match(standingProblem({ ...st, targetId: '40' })!, /владелец/);
  assert.match(standingProblem({ ...st, targetPos: 8 })!, /роли бота/);
  assert.match(standingProblem({ ...st, targetPos: 5 })!, /вашей/);
  // the owner may punish anybody below the bot; a person who left the server has no role to compare
  assert.equal(standingProblem({ ...st, modId: '40', targetPos: 7 }), null);
  assert.equal(standingProblem({ ...st, inGuild: false, targetPos: 99 }), null);
});

test('reason, days and ids are cleaned', () => {
  assert.equal(cleanReason('  спам \r\n\n\n\nещё '), 'спам \n\nещё');
  assert.equal(cleanReason(null), '');
  assert.equal(cleanReason('я'.repeat(900)).length, MAX_REASON);
  assert.equal(deleteDays(7), 7);
  assert.equal(deleteDays(3), 0);
  assert.equal(deleteDays('7'), 0);
  assert.equal(deleteSeconds(1), 86_400);
  assert.equal(daysText(0), 'не удалять');
  assert.equal(daysText(7), 'за 7 дней');
  assert.equal(idFromInput('123456789012345678'), '123456789012345678');
  assert.equal(idFromInput('<@!123456789012345678>'), '123456789012345678');
  assert.equal(idFromInput('Вася'), null);
  assert.equal(idFromInput('123'), null);
  assert.ok(auditReason('mod', 'я'.repeat(900)).length <= 500);
});

test('confirmation ids round-trip and expire', () => {
  const t = newToken();
  assert.match(t, /^[0-9a-z]{8}$/);
  assert.deepEqual(parsePunishId(punishId('go', t)), { action: 'go', token: t });
  assert.equal(parsePunishId('mod:go:!!'), null);
  assert.equal(parsePunishId('clear:go:abcdefgh'), null);
  assert.ok(punishId('no', t).length <= 100);
  assert.equal(isStale(1000, 1000 + PUNISH_TTL_MS), false);
  assert.equal(isStale(1000, 1001 + PUNISH_TTL_MS), true);
});

test('texts: the private message and the hint after repeated warnings', () => {
  assert.match(dmText('ban', 'Сервер').text, /Сервер/);
  assert.match(dmText('warn', 'Сервер', 2).title, /№2/);
  assert.equal(escalationHint(2), '');
  assert.match(escalationHint(3), /3-е/);
});

test('the ban list: pages, lines and the ids of the page buttons', () => {
  assert.deepEqual(paginate(0, 0), { page: 0, pages: 1, from: 0, to: 0 });
  assert.deepEqual(paginate(25, 1), { page: 1, pages: 3, from: BAN_PAGE, to: 2 * BAN_PAGE });
  assert.deepEqual(paginate(25, 9), { page: 2, pages: 3, from: 20, to: 25 });
  assert.deepEqual(paginate(25, -4), { page: 0, pages: 3, from: 0, to: 10 });
  assert.equal(banLine({ id: '123456789012345678', username: 'Va*sya', reason: '' }), '**Vasya** · `123456789012345678`');
  assert.equal(banLine({ id: '1', username: 'a', reason: 'читы\nи спам' }), '**a** · `1` — читы и спам');
  assert.equal(parsePageId(pageId(3)), 3);
  assert.equal(parsePageId('mod:go:abcdefgh'), null);
  assert.ok(pageId(999).length <= 100);
});
