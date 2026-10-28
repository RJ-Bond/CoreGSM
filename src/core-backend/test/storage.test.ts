import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('data storage (administrator)', () => {
  let api: Api;
  let token = '';
  before(async () => { api = await startBackend({ HISTORY_DAYS: '14' }); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('lists the kinds of rows with their retention', async () => {
    const r = await api.call('GET', '/api/system/storage', { token });
    assert.equal(r.status, 200);
    assert.ok(r.body.dbBytes > 0);
    const byId = Object.fromEntries(r.body.tables.map((t: { id: string }) => [t.id, t]));
    assert.equal(byId.history.days, 14);
    assert.equal(byId.playerSessions.days, 90);
    assert.equal(typeof byId.history.rows, 'number');
  });

  it('prunes on demand and answers with the new numbers', async () => {
    const r = await api.call('POST', '/api/system/storage/prune', { token });
    assert.equal(r.status, 200);
    assert.equal(r.body.tables.length, 4);
  });

  it('is for administrators only', async () => {
    assert.ok([401, 403].includes((await api.call('GET', '/api/system/storage')).status));
    assert.ok([401, 403].includes((await api.call('POST', '/api/system/storage/prune')).status));
  });
});
