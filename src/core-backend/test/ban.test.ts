/** Blocking an account: signed out at once, cannot sign in, the reason is reported, unblocking restores access. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('api: ban', () => {
  let api: Api;
  let admin = '';
  let tok = '';
  let id = 0;
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    tok = (await api.call('POST', '/api/auth/register', { body: { username: 'trouble', password: 'Passw0rd!long', acceptRules: true } })).body.token;
    id = (await api.call('GET', '/api/users', { token: admin })).body.find((u: { username: string }) => u.username === 'trouble').id;
  });
  after(async () => { await api.stop(); });

  it('a block signs the person out and rejects a new sign-in with the reason', async () => {
    assert.equal((await api.call('GET', '/api/me', { token: tok })).status, 200);
    const r = await api.call('POST', `/api/users/${id}/ban`, { token: admin, body: { reason: 'спам', hours: 2 } });
    assert.equal(r.status, 200);
    assert.equal((await api.call('GET', '/api/me', { token: tok })).status, 401);
    const login = await api.call('POST', '/api/auth/login', { body: { username: 'trouble', password: 'Passw0rd!long' } });
    assert.equal(login.status, 403);
    assert.equal(login.body.banned, true);
    assert.equal(login.body.reason, 'спам');
    assert.ok(login.body.until > Date.now());
    const row = (await api.call('GET', '/api/users', { token: admin })).body.find((u: { id: number }) => u.id === id);
    assert.equal(row.ban.reason, 'спам');
  });

  it('unblocking lets the person in again', async () => {
    assert.equal((await api.call('POST', `/api/users/${id}/unban`, { token: admin })).status, 200);
    assert.equal((await api.call('POST', '/api/auth/login', { body: { username: 'trouble', password: 'Passw0rd!long' } })).status, 200);
    assert.equal((await api.call('POST', `/api/users/${id}/unban`, { token: admin })).status, 404);
  });

  it('an administrator and yourself cannot be blocked', async () => {
    const users = (await api.call('GET', '/api/users', { token: admin })).body as { id: number; role: string }[];
    const a = users.find((u) => u.role === 'admin')!;
    assert.equal((await api.call('POST', `/api/users/${a.id}/ban`, { token: admin, body: {} })).status, 409);
  });
});
