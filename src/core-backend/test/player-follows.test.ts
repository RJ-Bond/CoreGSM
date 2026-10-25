/** Following a player: /api/me/follows and /api/players/:nick/follow. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('api: follow a player', () => {
  let api: Api;
  let admin = '';
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
  });
  after(async () => { await api.stop(); });

  it('needs a signed-in user', async () => {
    const r = await api.call('PUT', '/api/players/Alex/follow');
    assert.equal(r.status, 401);
  });

  it('follows once (the case of a nick does not matter) and lists it', async () => {
    assert.equal((await api.call('PUT', '/api/players/Alex/follow', { token: admin })).status, 200);
    assert.equal((await api.call('PUT', '/api/players/alex/follow', { token: admin })).status, 200);
    const l = await api.call('GET', '/api/me/follows', { token: admin });
    assert.equal(l.body.length, 1);
    assert.equal(l.body[0].nick, 'Alex');
  });

  it('stops following', async () => {
    assert.equal((await api.call('DELETE', '/api/players/ALEX/follow', { token: admin })).status, 200);
    const l = await api.call('GET', '/api/me/follows', { token: admin });
    assert.deepEqual(l.body, []);
  });

  it('allows at most 30 nicks', async () => {
    for (let i = 0; i < 30; i++) assert.equal((await api.call('PUT', `/api/players/nick${i}/follow`, { token: admin })).status, 200);
    const r = await api.call('PUT', '/api/players/one-too-many/follow', { token: admin });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'follow_limit');
    // a nick that is already followed is not a new one
    assert.equal((await api.call('PUT', '/api/players/NICK3/follow', { token: admin })).status, 200);
  });
});
