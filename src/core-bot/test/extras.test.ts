import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dashboardEmbed, dashColor, serverLine } from '../src/dashboardLogic.js';
import { followId, followText, parseFollow } from '../src/followLogic.js';
import { agreeId, cleanNick, nickOptions, parseLink } from '../src/linkLogic.js';

test('follow ids round-trip', () => {
  assert.deepEqual(parseFollow(followId('server', 7, true)), { kind: 'server', id: 7, on: true });
  assert.deepEqual(parseFollow(followId('server', 7, false)), { kind: 'server', id: 7, on: false });
  assert.deepEqual(parseFollow(followId('player', 'Bob The Great', true)), { kind: 'player', nick: 'Bob The Great', on: true });
  assert.deepEqual(parseFollow('fol:up:Eve'), { kind: 'player', nick: 'Eve', on: false });
  for (const bad of ['fol:s:x', 'fol:s:', 'fol:z:1', 'clear:go']) assert.equal(parseFollow(bad), null, bad);
  assert.ok(followId('player', 'x'.repeat(200), true).length <= 100);
});

test('follow answers', () => {
  const f = { kind: 'server', id: 1, on: true } as const;
  assert.match(followText({ status: 'ok', on: true, name: 'S' }, f).title, /следите за «S»/);
  assert.match(followText({ status: 'ok', on: false, name: 'S' }, { ...f, on: false }).title, /больше не следите/);
  assert.equal(followText({ status: 'unlinked' }, f).ok, false);
  assert.match(followText({ status: 'limit', max: 30 }, { kind: 'player', nick: 'x', on: true }).text, /30/);
});

test('link wizard ids and nicks', () => {
  assert.deepEqual(parseLink('lnk:pick'), { kind: 'pick' });
  assert.deepEqual(parseLink(agreeId('  Bob  ')), { kind: 'agree', nick: 'Bob' });
  assert.equal(parseLink('lnk:ok:x'), null);
  assert.equal(parseLink('lnk:what'), null);
  assert.deepEqual(nickOptions(['Bob', 'bob', 'A', 7, 'Eve']), [{ label: 'Bob', value: 'Bob' }, { label: 'Eve', value: 'Eve' }]);
  assert.equal(nickOptions(Array.from({ length: 40 }, (_, i) => `nick${i}`)).length, 25);
  assert.equal(nickOptions('x').length, 0);
  assert.equal(cleanNick('  A\tb  '), 'A b');
  assert.equal(cleanNick('x'), null);
  assert.equal(cleanNick('x'.repeat(41)), null);
});

test('dashboard embed', () => {
  const st = { footer: 'CoreGSM', accent: 1, logoUrl: null, version: '1.1.42' };
  const servers = [
    { id: 1, name: 'A', online: true, players: 5, maxPlayers: 10, map: 'Vardoran' },
    { id: 2, name: 'B', online: false, players: 0, maxPlayers: 0, map: null },
  ];
  const e = dashboardEmbed({ players: 5, servers, url: null }, { top: [{ name: 'Bob', hours: 12.5 }] }, st, 1_700_000_000_000);
  assert.match(e.title, /1\/2 онлайн · 5 игроков/);
  assert.equal(e.color, 0xf5b01e);
  assert.match(e.description, /🟢 \*\*A\*\*\n👥 \*\*5\*\*\/10/);
  assert.match(e.description, /🔴 \*\*B\*\*/);
  assert.match(e.fields[2]!.value, /🥇 \*\*Bob\*\* — 12,5 ч/);
  assert.match(e.footer.text, /v1\.1\.42/);
  assert.equal(dashColor(0, 3), 0xe74c3c);
  assert.equal(dashColor(3, 3), 0x2ecc71);
  assert.equal(serverLine(servers[1]!), '🔴 **B** — не в сети');
  const many = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `S${i}`, online: true, players: 1, maxPlayers: 0, map: null }));
  assert.match(dashboardEmbed({ players: 20, servers: many, url: null }, null, st).description, /…и ещё 5/);
});
