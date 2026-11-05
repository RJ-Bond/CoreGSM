import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WELCOME, FUNNY_WELCOMES, pickIndex, renderWelcome, renderWelcomePick, welcomeVariants } from '../src/community/welcomeLogic.ts';

describe('renderWelcome', () => {
  it('fills the placeholders', () => {
    assert.equal(renderWelcome('Привет, {user}, это {server}!', { userId: '123456789012345678', server: 'My *Club*' }), 'Привет, <@123456789012345678>, это My Club!');
  });
  it('uses the default text when empty and keeps /register in it', () => {
    const r = renderWelcome('  ', { userId: '1', server: 'S' });
    assert.ok(r.includes('/register'));
    assert.ok(DEFAULT_WELCOME.includes('{user}'));
  });
  it('strips non-digits from the id (no injected mentions)', () => {
    assert.equal(renderWelcome('{user}', { userId: '12@everyone34', server: 'S' }), '<@1234>');
  });
});

describe('funny greetings', () => {
  const v = { userId: '123456789012345678', server: 'My *Club*', count: 42 };
  it('every funny line greets the newcomer by a mention', () => {
    for (const l of FUNNY_WELCOMES) assert.ok(l.includes('{user}'), l);
    assert.ok(FUNNY_WELCOMES.length >= 10);
  });
  it('an empty text picks a funny one and keeps the /register hint in a plain message', () => {
    const r = renderWelcomePick('', v, () => 0, -1, false);
    assert.equal(r.funny, true);
    assert.ok(r.content.includes('<@123456789012345678>'));
    assert.ok(r.content.includes('/register'));
    assert.ok(!r.content.includes('{'));
  });
  it('in an embed the hint is not glued to the text (it has its own block)', () => {
    const r = renderWelcomePick('', v, () => 0, -1, true);
    assert.equal(r.funny, true);
    assert.ok(!r.content.includes('-#'));
  });
  it('the same greeting is never picked twice in a row', () => {
    const n = FUNNY_WELCOMES.length;
    for (let last = 0; last < n; last++) assert.notEqual(pickIndex(n, last / n, last), last);
    assert.equal(pickIndex(1, 0.9, 0), 0);
    assert.equal(pickIndex(n, 0.999999, -1), n - 1);
  });
  it('own variants are split by a line with --- and one is picked', () => {
    const text = 'Привет, {user}!\n---\nЗдорово, что ты с нами, {user}\n  ---  \nСалют, {user}';
    const { list, funny } = welcomeVariants(text, false);
    assert.equal(funny, false);
    assert.equal(list.length, 3);
    assert.equal(renderWelcome(text, v, () => 0.5), 'Здорово, что ты с нами, <@123456789012345678>');
  });
  it('a dash line inside a sentence does not split', () => {
    assert.equal(welcomeVariants('Привет --- друг {user}', false).list.length, 1);
  });
  it('{count} is filled in, and lines with it are skipped while the number is unknown', () => {
    assert.equal(renderWelcome('Ты {count}-й!', v), 'Ты 42-й!');
    assert.deepEqual(welcomeVariants('Ты {count}-й, {user}\n---\nПривет, {user}', false).list, ['Привет, {user}']);
    assert.equal(welcomeVariants('Ты {count}-й, {user}', false).list[0], DEFAULT_WELCOME);
    assert.ok(welcomeVariants('', false).list.every((l) => !l.includes('{count}')));
    assert.ok(welcomeVariants('', true).list.some((l) => l.includes('{count}')));
  });
  it('no injected pings through the server name or the count', () => {
    const r = renderWelcome('{user} {server} {count}', { userId: '1', server: '@everyone @here', count: 7 });
    assert.equal(r, '<@1> everyone here 7');
  });
});
