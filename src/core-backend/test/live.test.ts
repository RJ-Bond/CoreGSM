import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('live updates (Server-Sent Events)', () => {
  let api: Api;
  let token = '';
  let id = 0;
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
    const c = await api.call('POST', '/api/servers', { token, body: { name: 'Live test', game: 'vrising', host: '127.0.0.1', port: 25599 } });
    id = c.body.id;
  });
  after(async () => { await api.stop(); });

  it('a signal arrives as soon as a server has been polled, and it carries no data', async () => {
    const ac = new AbortController();
    const res = await fetch(`${api.base}/api/live`, { headers: { authorization: `Bearer ${token}` }, signal: ac.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    // the greeting first
    let text = dec.decode((await reader.read()).value);
    assert.match(text, /: ok/);
    // a poll of the server (the manual refresh is one too)
    void api.call('POST', `/api/servers/${id}/refresh`, { token });
    const deadline = Date.now() + 25_000;
    let pending = reader.read();
    while (!/event: status/.test(text) && Date.now() < deadline) {
      // one read stays pending: a lost race would swallow its chunk
      const r = await Promise.race([pending, new Promise<null>((ok) => setTimeout(() => ok(null), 500))]);
      if (r) { if (r.done) break; text += dec.decode(r.value); pending = reader.read(); }
    }
    pending.catch(() => undefined);
    ac.abort();
    assert.match(text, /event: status\ndata: \d+\n\n/);
    assert.doesNotMatch(text, /Live test/, 'no names or numbers travel in the signal');
  });
});
