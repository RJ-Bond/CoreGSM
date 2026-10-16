/** Moderator permissions: the default set, what the administrator ticks, and what /api/me reports. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('api: moderator permissions', () => {
  let api: Api;
  let admin = '';
  let mod = '';
  let modId = 0;
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    mod = (await api.call('POST', '/api/auth/register', { body: { username: 'mod_one', password: 'Passw0rd!long', acceptRules: true } })).body.token;
    modId = (await api.call('GET', '/api/users', { token: admin })).body.find((u: { username: string }) => u.username === 'mod_one').id;
  });
  after(async () => { await api.stop(); });

  const can = async (method: string, url: string, body?: unknown) => (await api.call(method, url, { token: mod, body })).status;

  it('a player has no permissions; a new moderator gets news and moderation', async () => {
    assert.deepEqual((await api.call('GET', '/api/me', { token: mod })).body.perms, []);
    assert.equal(await can('GET', '/api/news/settings'), 403);
    await api.call('PUT', `/api/users/${modId}`, { token: admin, body: { role: 'moderator' } });
    assert.deepEqual((await api.call('GET', '/api/me', { token: mod })).body.perms, ['news', 'moderation']);
    assert.equal(await can('GET', '/api/news/settings'), 200);
    assert.equal(await can('GET', '/api/reviews'), 200);
    assert.equal(await can('GET', '/api/gallery/queue'), 200);
    const r = await api.call('GET', '/api/audit', { token: mod });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'perm_missing');
    assert.equal(await can('GET', '/api/maintenance'), 403);
    assert.equal(await can('POST', '/api/servers/test', { game: 'minecraft', host: '127.0.0.1', port: 1 }), 403);
  });

  it('the administrator ticks other permissions; deleting a server stays with administrators', async () => {
    await api.call('PUT', `/api/users/${modId}`, { token: admin, body: { role: 'moderator', perms: ['journal', 'maintenance', 'servers'] } });
    const list = (await api.call('GET', '/api/users', { token: admin })).body;
    assert.deepEqual(list.find((u: { id: number }) => u.id === modId).perms, ['servers', 'maintenance', 'journal']);
    assert.equal(await can('GET', '/api/news/settings'), 403);
    assert.equal(await can('GET', '/api/reviews'), 403);
    assert.equal(await can('GET', '/api/audit'), 200);
    assert.equal(await can('GET', '/api/maintenance'), 200);
    assert.notEqual(await can('POST', '/api/servers/test', { game: 'minecraft', host: '127.0.0.1', port: 1 }), 403);
    assert.equal(await can('DELETE', '/api/servers/1'), 403);
  });

  it('a role change without perms keeps the ticked ones; unknown permissions are refused', async () => {
    await api.call('PUT', `/api/users/${modId}`, { token: admin, body: { role: 'player' } });
    assert.deepEqual((await api.call('GET', '/api/me', { token: mod })).body.perms, []);
    await api.call('PUT', `/api/users/${modId}`, { token: admin, body: { role: 'moderator' } });
    assert.deepEqual((await api.call('GET', '/api/me', { token: mod })).body.perms, ['servers', 'maintenance', 'journal']);
    assert.equal((await api.call('PUT', `/api/users/${modId}`, { token: admin, body: { role: 'moderator', perms: ['root'] } })).status, 400);
  });
});
