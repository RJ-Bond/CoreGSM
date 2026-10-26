import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { avatarColor, initialOf, stateBand, whoInGame } from '../src/cardLogic.ts';

describe('card logic', () => {
  it('initials skip symbols and brackets', () => {
    assert.equal(initialOf('Yuki'), 'Y');
    assert.equal(initialOf('[RU] vlad'), 'R');
    assert.equal(initialOf('  ~~~ '), '?');
    assert.equal(initialOf('42bro'), '4');
  });
  it('a colour is stable per name and ignores case', () => {
    assert.equal(avatarColor('Yuki'), avatarColor('yuki'));
    assert.match(avatarColor('x'), /^#[0-9a-f]{6}$/);
  });
  it('shows four names and counts the rest', () => {
    assert.deepEqual(whoInGame(['a', 'b', 'c', 'd', 'e', 'f']), { shown: ['a', 'b', 'c', 'd'], rest: 2 });
    assert.deepEqual(whoInGame([' ', 'x']), { shown: ['x'], rest: 0 });
  });
  it('banner: none online, offline with the time, maintenance wins', () => {
    const t = Date.UTC(2026, 9, 26, 11, 20);
    assert.equal(stateBand({ known: true, online: true, since: t, maintenanceUntil: null }, 'UTC'), null);
    assert.equal(stateBand({ known: false, online: false, since: null, maintenanceUntil: null }, 'UTC'), null);
    assert.deepEqual(stateBand({ known: true, online: false, since: t, maintenanceUntil: null }, 'UTC'), { kind: 'offline', text: 'ОФЛАЙН · с 11:20' });
    assert.equal(stateBand({ known: true, online: false, since: null, maintenanceUntil: null }, 'UTC')?.text, 'ОФЛАЙН');
    assert.equal(stateBand({ known: true, online: false, since: t, maintenanceUntil: t + 3_600_000 }, 'UTC')?.kind, 'maint');
  });
});
