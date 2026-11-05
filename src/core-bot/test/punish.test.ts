import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS } from '../src/commands.js';
import { PUNISH_COMMANDS } from '../src/punish.js';
import { APPEAL_PAUSE_MS, UNDO_MS, appealDecideId, appealGoId, appealSendId, durationHints, durationLabel, messageLink, parseAppeal, parseDuration, parseReasonModal, parseUndoId, parseUserBtn, reasonHints, reasonModalId, undoFresh, undoId, userBtnId, warnBar, warnColor, BAN_PAGE, MAX_REASON, banLine, pageId, paginate, parsePageId, auditReason, cleanReason, daysText, deleteDays, deleteSeconds, dmText, escalationHint, idFromInput, isStale, newToken, parsePunishId, punishId, standingProblem, PUNISH_TTL_MS } from '../src/punishLogic.js';

test('the punishment commands are registered once, for administrators only, and fit the limits of Discord', () => {
  for (const name of ['ban', 'unban', 'kick', 'warn', 'mute', 'unmute', '⚠️ Предупредить', '⚠️ Предупредить автора']) assert.equal(COMMANDS.filter((c) => c.name === name).length, 1, name);
  for (const c of PUNISH_COMMANDS) {
    assert.equal(c.dm_permission, false);
    assert.equal(c.default_member_permissions, String(1n << 3n));
    if (!('options' in c)) {
      // a context menu: a name up to 32 characters, no description
      assert.ok(c.name.length <= 32);
      assert.ok(c.type === 2 || c.type === 3);
      continue;
    }
    assert.ok(c.description.length <= 100);
    for (const d of Object.values(c.description_localizations)) assert.ok(d.length <= 100, d);
    for (const o of c.options) {
      assert.ok(o.description.length <= 100, o.description);
      for (const d of Object.values(o.description_localizations)) assert.ok(d.length <= 100, d);
    }
    // Discord wants the required options first
    const flags = c.options.map((o) => !!o.required);
    assert.deepEqual(flags, [...flags].sort((x, y) => Number(y) - Number(x)), c.name);
  }
});

test('the reason is required for a ban, a kick and a warning, optional for an unban', () => {
  const required = (name: string) => (PUNISH_COMMANDS.find((c) => c.name === name) as { options: { name: string; required?: boolean }[] }).options.find((o) => o.name === 'reason')!.required;
  assert.equal(required('ban'), true);
  assert.equal(required('kick'), true);
  assert.equal(required('warn'), true);
  assert.equal(required('mute'), true);
  assert.equal(required('unban'), false);
  assert.equal(required('unmute'), false);
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
  assert.match(dmText('warn', 'Сервер', { warnNo: 2 }).title, /№2/);
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

test('mute length: numbers with units in two languages, 1 minute to 28 days', () => {
  assert.equal(parseDuration('30'), 30);
  assert.equal(parseDuration('30m'), 30);
  assert.equal(parseDuration('2h'), 120);
  assert.equal(parseDuration('2 ч'), 120);
  assert.equal(parseDuration('1d'), 1440);
  assert.equal(parseDuration('3 дн'), 4320);
  assert.equal(parseDuration('1w'), 10_080);
  assert.equal(parseDuration('28d'), 40_320);
  assert.equal(parseDuration('29d'), null);
  assert.equal(parseDuration('0'), null);
  assert.equal(parseDuration('скоро'), null);
  assert.equal(durationLabel(90), '1 ч 30 мин');
  assert.equal(durationLabel(1500), '1 д 1 ч');
  assert.equal(durationHints('')[0]!.value, '10m');
  assert.equal(durationHints('45')[0]!.value, '45');
  assert.ok(durationHints('1h').some((h) => h.value === '1h'));
});

test('the scale of warnings and its colour', () => {
  assert.equal(warnBar(2, 5), '●●○○○ 2 из 5');
  assert.equal(warnBar(7, 5), '●●●●● 7 из 5');
  assert.equal(warnBar(1, 20), '●○○○○○○○○○ 1 из 20');
  assert.equal(warnColor(1, 5), 0xf5b01e);
  assert.equal(warnColor(3, 5), 0xe67e22);
  assert.equal(warnColor(5, 5), 0xe74c3c);
});

test('reasons offered while typing', () => {
  const r = ['Спам', 'Оскорбления', 'Читы'];
  assert.deepEqual(reasonHints(r, '').length, 3);
  assert.deepEqual(reasonHints(r, 'ЧИТ'), [{ name: 'Читы', value: 'Читы' }]);
  assert.deepEqual(reasonHints(r, 'zzz'), []);
});

test('ids of the buttons, windows and appeals round-trip and stay short', () => {
  assert.deepEqual(parseUndoId(undoId(42, 1_800_000_000_000)), { caseId: 42, at: 1_800_000_000_000 });
  assert.equal(undoFresh(1000, 1000 + UNDO_MS), true);
  assert.equal(undoFresh(1000, 1000 + UNDO_MS + 6000), false);
  const u = '123456789012345678';
  for (const k of ['hist', 'more', 'unb', 'unm'] as const) assert.deepEqual(parseUserBtn(userBtnId(k, u)), { kind: k, userId: u });
  assert.equal(parseUserBtn('mod:hist:12'), null);
  const link = reasonModalId(u, '223456789012345678', '323456789012345678');
  assert.ok(link.length <= 100);
  assert.deepEqual(parseReasonModal(link), { userId: u, chan: '223456789012345678', msg: '323456789012345678' });
  assert.deepEqual(parseReasonModal(reasonModalId(u)), { userId: u, chan: '0', msg: '0' });
  assert.deepEqual(parseAppeal(appealGoId('223456789012345678')), { kind: 'go', guildId: '223456789012345678', userId: '' });
  assert.deepEqual(parseAppeal(appealSendId('223456789012345678'))?.kind, 'send');
  assert.deepEqual(parseAppeal(appealDecideId(true, '223456789012345678', u)), { kind: 'ok', guildId: '223456789012345678', userId: u });
  assert.equal(parseAppeal(appealDecideId(false, '223456789012345678', u))?.kind, 'no');
  assert.equal(parseAppeal('appeal:ok:1:2'), null);
  assert.equal(messageLink('1', '2', '3'), 'https://discord.com/channels/1/2/3');
  assert.ok(APPEAL_PAUSE_MS > 0);
});
