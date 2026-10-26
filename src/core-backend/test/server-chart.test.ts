import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startBackend, type Api } from './harness.ts';

describe('api: server chart image', () => {
  let api: Api;
  before(async () => { api = await startBackend(); });
  after(async () => { await api.stop(); });

  it('a wrong signature is a 404, not an image', async () => {
    const r = await api.call('GET', `/api/server-chart/1-${'a'.repeat(20)}.png`);
    assert.equal(r.status, 404);
  });
});
