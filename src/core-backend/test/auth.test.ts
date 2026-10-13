import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ADMIN, setupAdmin, startBackend, type Api } from './harness.ts';

describe('auth, setup, roles', () => {
  let api: Api;
  let admin = '';
  before(async () => { api = await startBackend(); });
  after(async () => { await api.stop(); });

  it('asks for the first-run setup and protects it with the code', async () => {
    const st = await api.call('GET', '/api/setup/status');
    assert.equal(st.status, 200);
    assert.equal(st.body.needed, true);
    const bad = await api.call('POST', '/api/setup', { body: { ...ADMIN, code: 'wrong-code' } });
    assert.equal(bad.status, 403);
    const short = await api.call('POST', '/api/setup', { body: { username: 'admin', password: 'short', code: api.setupCode } });
    assert.equal(short.status, 400);
  });

  it('creates the administrator once', async () => {
    admin = await setupAdmin(api);
    assert.ok(admin.length > 20);
    const again = await api.call('POST', '/api/setup', { body: { ...ADMIN, code: api.setupCode } });
    assert.equal(again.status, 409);
    assert.equal((await api.call('GET', '/api/setup/status')).body.needed, false);
  });

  it('logs in, rejects a wrong password and unauthenticated calls', async () => {
    const ok = await api.call('POST', '/api/auth/login', { body: ADMIN });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);
    const bad = await api.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'nope-nope-nope' } });
    assert.equal(bad.status, 401);
    assert.equal((await api.call('GET', '/api/me')).status, 401);
    const me = await api.call('GET', '/api/me', { token: admin });
    assert.equal(me.status, 200);
    assert.equal(me.body.username, 'admin');
    assert.equal(me.body.role, 'admin');
  });

  it('registers a player who cannot reach admin endpoints', async () => {
    const reg = await api.call('POST', '/api/auth/register', { body: { username: 'Иван Петров', password: 'Playerpass1' } });
    assert.ok([200, 201].includes(reg.status), JSON.stringify(reg.body));
    const player = reg.body.token as string;
    assert.ok(player);
    const me = await api.call('GET', '/api/me', { token: player });
    assert.equal(me.body.role, 'player');
    const create = await api.call('POST', '/api/servers', { token: player, body: { name: 'x', game: 'minecraft', host: '127.0.0.1', port: 25565 } });
    assert.equal(create.status, 403);
    assert.equal((await api.call('GET', '/api/users', { token: player })).status, 403);
    assert.equal((await api.call('GET', '/api/users', { token: admin })).status, 200);
  });

  it('matches non-ASCII logins case-insensitively', async () => {
    const r = await api.call('POST', '/api/auth/login', { body: { username: 'иван петров', password: 'Playerpass1' } });
    assert.equal(r.status, 200);
  });

  it('checks username availability', async () => {
    const taken = await api.call('GET', `/api/auth/check?username=${encodeURIComponent('admin')}`);
    assert.equal(taken.body.available, false);
    const free = await api.call('GET', `/api/auth/check?username=${encodeURIComponent('freshname')}`);
    assert.equal(free.body.available, true);
  });
});

describe('account: password and e-mail', () => {
  let api: Api;
  let token = '';
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('requires matching confirmation and the right current password', async () => {
    const mismatch = await api.call('POST', '/api/auth/password', { token, body: { current: ADMIN.password, next: 'Newpass123', confirm: 'Different1' } });
    assert.equal(mismatch.status, 400);
    const wrong = await api.call('POST', '/api/auth/password', { token, body: { current: 'not-the-password', next: 'Newpass123', confirm: 'Newpass123' } });
    assert.equal(wrong.status, 403);
    const ok = await api.call('POST', '/api/auth/password', { token, body: { current: ADMIN.password, next: 'Newpass123', confirm: 'Newpass123' } });
    assert.equal(ok.status, 200);
    assert.equal((await api.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'Newpass123' } })).status, 200);
  });

  it('validates the e-mail and asks for the password', async () => {
    const bad = await api.call('PUT', '/api/me/email', { token, body: { email: 'not-an-email', current: 'Newpass123' } });
    assert.equal(bad.status, 400);
    const noPass = await api.call('PUT', '/api/me/email', { token, body: { email: 'a@example.com' } });
    assert.equal(noPass.status, 403);
    const ok = await api.call('PUT', '/api/me/email', { token, body: { email: 'Admin@Example.com', current: 'Newpass123' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.email, 'admin@example.com');
    assert.equal((await api.call('GET', '/api/me', { token })).body.email, 'admin@example.com');
  });
});
