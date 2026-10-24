import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const TOKEN = 'm'.repeat(32);

describe('/api/metrics', () => {
  describe('without METRICS_TOKEN', () => {
    let api: Api;
    before(async () => { api = await startBackend(); });
    after(async () => { await api.stop(); });
    it('does not exist', async () => {
      assert.equal((await fetch(`${api.base}/api/metrics`)).status, 404);
      assert.equal((await fetch(`${api.base}/api/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404);
    });
  });

  describe('with METRICS_TOKEN', () => {
    let api: Api;
    let admin = '';
    before(async () => { api = await startBackend({ METRICS_TOKEN: TOKEN }); admin = await setupAdmin(api); });
    after(async () => { await api.stop(); });

    it('asks for the token', async () => {
      assert.equal((await fetch(`${api.base}/api/metrics`)).status, 401);
      assert.equal((await fetch(`${api.base}/api/metrics`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
      // a panel session is not the metrics token
      assert.equal((await fetch(`${api.base}/api/metrics`, { headers: { Authorization: `Bearer ${admin}` } })).status, 401);
    });

    it('answers in the Prometheus text format', async () => {
      await api.call('POST', '/api/servers', { token: admin, body: { name: 'My "quoted" server', game: 'minecraft', host: '127.0.0.1', port: 25565 } });
      const r = await fetch(`${api.base}/api/metrics`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type') ?? '', /^text\/plain; version=0\.0\.4/);
      const text = await r.text();
      assert.match(text, /^# TYPE coregsm_servers gauge$/m);
      assert.match(text, /^coregsm_servers 1$/m);
      assert.match(text, /^coregsm_db_bytes \d+$/m);
      assert.match(text, /^coregsm_server_online\{id="\d+",name="My \\"quoted\\" server",game="minecraft"\} [01]$/m);
      assert.ok(text.endsWith('\n'));
    });
  });
});
