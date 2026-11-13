/** A backup of one panel is restored into another one: the data is there after the restart and the account signs in. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ADMIN, setupAdmin, startBackend, type Api } from './harness.ts';

describe('backup and restore round trip', () => {
  let a: Api;
  let b: Api;
  let tokenA = '';
  let tokenB = '';
  before(async () => {
    a = await startBackend();
    b = await startBackend();
    tokenA = await setupAdmin(a);
    tokenB = await setupAdmin(b);
  });
  after(async () => { await a.stop(); await b.stop(); });

  it('brings the servers and the people of one panel into a fresh one', async () => {
    const made = await a.call('POST', '/api/servers', { token: tokenA, body: { name: 'Roundtrip server', game: 'vrising', host: '127.0.0.1', port: 25597 } });
    assert.ok(made.status < 300, `a server is added: ${made.status}`);
    assert.equal((await a.call('POST', '/api/auth/register', { body: { username: 'restored_user', password: 'Passw0rd!long', acceptRules: true } })).status < 300, true);
    // the copy: the protected action is confirmed with the password first, then the archive is read as bytes
    assert.equal((await a.call('POST', '/api/auth/reauth', { token: tokenA, body: { password: ADMIN.password } })).status, 200);
    const dl = await fetch(`${a.base}/api/backup`, { headers: { Authorization: `Bearer ${tokenA}` } });
    assert.equal(dl.status, 200);
    const archive = Buffer.from(await dl.arrayBuffer());
    assert.ok(archive.length > 1000, 'the archive has content');

    // the fresh panel has none of it yet
    const before = (await b.call('GET', '/api/servers', { token: tokenB })).body as { name: string }[];
    assert.ok(!before.some((s) => s.name === 'Roundtrip server'));
    assert.equal((await b.call('POST', '/api/auth/reauth', { token: tokenB, body: { password: ADMIN.password } })).status, 200);
    const up = await fetch(`${b.base}/api/backup/restore`, { method: 'POST', headers: { Authorization: `Bearer ${tokenB}`, 'content-type': 'application/octet-stream' }, body: archive });
    const upBody = (await up.json()) as { ok?: boolean; restarting?: boolean };
    assert.equal(up.status, 200, JSON.stringify(upBody));
    assert.equal(upBody.restarting, true);

    // the swap happens at the start: the panel restarts and the data of the other one is in place
    await b.restart();
    const login = await b.call('POST', '/api/auth/login', { body: ADMIN });
    assert.equal(login.status, 200, 'the administrator of the copy signs in');
    const t2 = (login.body as { token: string }).token;
    const servers = (await b.call('GET', '/api/servers', { token: t2 })).body as { name: string }[];
    assert.ok(servers.some((s) => s.name === 'Roundtrip server'), 'the server of the copy is there');
    const users = (await b.call('GET', '/api/users', { token: t2 })).body as { username: string }[];
    assert.ok(users.some((u) => u.username === 'restored_user'), 'the player of the copy is there');
  });
});
