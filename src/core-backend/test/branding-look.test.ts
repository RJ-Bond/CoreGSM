import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('api: the default look of the panel', () => {
  let api: Api;
  let token = '';
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('is classic at first, an administrator can set Ember, anything else is refused, and guests see it in the access data', async () => {
    assert.equal(((await api.call('GET', '/api/access')).body as { brand: { look: string } }).brand.look, 'classic');
    assert.equal((await api.call('PUT', '/api/branding/look', { body: { look: 'ember' } })).status, 401);
    assert.equal((await api.call('PUT', '/api/branding/look', { token, body: { look: 'neon' } })).status, 400);
    const ok = await api.call('PUT', '/api/branding/look', { token, body: { look: 'ember' } });
    assert.equal(ok.status, 200);
    assert.equal((ok.body as { look: string }).look, 'ember');
    assert.equal(((await api.call('GET', '/api/access')).body as { brand: { look: string } }).brand.look, 'ember');
  });
});
