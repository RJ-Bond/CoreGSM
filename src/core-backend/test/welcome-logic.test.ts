import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WELCOME, renderWelcome } from '../src/welcomeLogic.ts';

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
