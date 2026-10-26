import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { clampRateLimit, extractKey, generateKey, hashKey, keyPrefix, looksLikeKey, SlidingWindow } from '../src/apiKeyLogic.ts';
import { badgeSvg, escapeXml, stateOf, valueText, widgetHtml } from '../src/badgeLogic.ts';
import { openApiSpec } from '../src/openapi.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('api key logic', () => {
  it('makes keys that look right and hashes them', () => {
    const k = generateKey();
    assert.match(k, /^cgsm_[A-Za-z0-9_-]{43}$/);
    assert.ok(looksLikeKey(k));
    assert.notEqual(k, generateKey());
    assert.equal(hashKey(k).length, 64);
    assert.equal(hashKey(k), hashKey(k));
    assert.equal(keyPrefix(k), k.slice(0, 10));
    assert.ok(!looksLikeKey('cgsm_short'));
    assert.ok(!looksLikeKey('nope'));
  });

  it('reads the key from Authorization or X-API-Key', () => {
    assert.equal(extractKey({ authorization: 'Bearer abc' }), 'abc');
    assert.equal(extractKey({ authorization: 'bearer   abc ' }), 'abc');
    assert.equal(extractKey({ 'x-api-key': ' xyz ' }), 'xyz');
    assert.equal(extractKey({ authorization: 'Basic abc' }), '');
    assert.equal(extractKey({}), '');
  });

  it('clamps the limit', () => {
    assert.equal(clampRateLimit(0), 1);
    assert.equal(clampRateLimit(10 ** 9), 6000);
    assert.equal(clampRateLimit(60.4), 60);
  });

  it('limits in a sliding window', () => {
    const w = new SlidingWindow(60_000);
    assert.equal(w.hit('a', 2, 1000).ok, true);
    assert.equal(w.hit('a', 2, 2000).remaining, 0);
    const r = w.hit('a', 2, 3000);
    assert.equal(r.ok, false);
    assert.equal(r.retryAfter, 58);
    assert.equal(w.hit('b', 2, 3000).ok, true);
    // the first request leaves the window
    assert.equal(w.hit('a', 2, 61_001).ok, true);
    w.prune(1_000_000);
    assert.equal(w.size, 0);
  });
});

describe('badge and widget', () => {
  const sv = { name: 'A&B <x> "q"', hasStatus: true, online: true, players: 5, maxPlayers: 10 };
  it('picks the state and the text', () => {
    assert.equal(stateOf(sv), 'online');
    assert.equal(stateOf({ ...sv, players: 10 }), 'full');
    assert.equal(stateOf({ ...sv, online: false }), 'offline');
    assert.equal(stateOf({ ...sv, hasStatus: false }), 'unknown');
    assert.equal(valueText(sv), '5/10');
    assert.equal(valueText({ ...sv, maxPlayers: 0 }), '5');
    assert.equal(valueText({ ...sv, online: false }), 'офлайн');
  });

  it('escapes the text', () => {
    assert.equal(escapeXml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    const svg = badgeSvg(sv);
    assert.ok(svg.startsWith('<svg'));
    assert.ok(!svg.includes('<x>'));
    assert.ok(svg.includes('A&amp;B &lt;x&gt;'));
    const html = widgetHtml({ ...sv, game: 'g', map: '<img src=x>', ping: 12, url: 'https://e.x/servers/1?a="zz"', brand: 'B<' });
    assert.ok(!html.includes('<img src=x>'));
    assert.ok(!html.includes('"zz"'));
    assert.ok(!html.includes('<script'));
  });
});

describe('openapi', () => {
  it('describes the endpoints', () => {
    const spec = openApiSpec({ version: '1.2.3', baseUrl: 'https://e.x', title: 'T' });
    assert.equal(spec.openapi, '3.0.3');
    assert.deepEqual(Object.keys(spec.paths).sort(), ['/api/v1/openapi.json', '/api/v1/servers', '/api/v1/servers/{id}', '/api/v1/status']);
  });
});

describe('api: keys, public API, badge, widget', () => {
  let api: Api;
  let token = '';
  let serverId = 0;
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
    const c = await api.call('POST', '/api/servers', { token, body: { name: 'Mine <b>', game: 'minecraft', host: '127.0.0.1', port: 25599 } });
    serverId = c.body.id as number;
  });
  after(async () => { await api.stop(); });

  const bearer = (k: string) => ({ headers: { Authorization: `Bearer ${k}` } });

  it('keeps key management to the administrator', async () => {
    assert.equal((await api.call('GET', '/api/integrations/keys')).status, 401);
    assert.equal((await api.call('POST', '/api/integrations/keys', { body: { name: 'x' } })).status, 401);
    assert.equal((await api.call('POST', '/api/integrations/keys', { token, body: { name: '' } })).status, 400);
  });

  it('creates a key, shows it once and stores only the hash', async () => {
    const c = await api.call('POST', '/api/integrations/keys', { token, body: { name: 'Forum', rateLimit: 5 } });
    assert.equal(c.status, 201);
    assert.match(c.body.key, /^cgsm_/);
    assert.equal(c.body.prefix, c.body.key.slice(0, 10));
    assert.equal(c.body.rateLimit, 5);
    const list = await api.call('GET', '/api/integrations/keys', { token });
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(JSON.stringify(list.body).includes(c.body.key), false);
    assert.equal(list.body[0].lastUsedAt, null);
  });

  it('serves the public API with a key and refuses without one', async () => {
    const k = (await api.call('POST', '/api/integrations/keys', { token, body: { name: 'A' } })).body.key as string;
    const noKey = await api.call('GET', '/api/v1/servers');
    assert.equal(noKey.status, 401);
    assert.equal(noKey.body.error.code, 'unauthorized');
    const wrong = await api.call('GET', '/api/v1/servers', bearer('cgsm_' + 'A'.repeat(43)));
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'invalid_key');

    const list = await api.call('GET', '/api/v1/servers', bearer(k));
    assert.equal(list.status, 200);
    const s = list.body.servers.find((x: { id: number }) => x.id === serverId);
    assert.equal(s.name, 'Mine <b>');
    assert.equal(s.host, undefined);
    assert.equal(s.port, undefined);
    assert.ok('players' in s && 'maxPlayers' in s && 'ping' in s && 'map' in s && 'version' in s && 'uptime24h' in s);

    const viaHeader = await api.call('GET', `/api/v1/servers/${serverId}`, { headers: { 'X-API-Key': k } });
    assert.equal(viaHeader.status, 200);
    assert.equal(viaHeader.body.id, serverId);
    assert.equal((await api.call('GET', '/api/v1/servers/999999', bearer(k))).status, 404);
    assert.equal((await api.call('GET', '/api/v1/servers/abc', bearer(k))).status, 404);

    const st = await api.call('GET', '/api/v1/status', bearer(k));
    assert.equal(st.status, 200);
    assert.ok(st.body.servers >= 1);
    assert.equal(st.body.online + st.body.offline, st.body.servers);

    const unknown = await api.call('GET', '/api/v1/nothing', bearer(k));
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, 'not_found');

    const spec = await api.call('GET', '/api/v1/openapi.json');
    assert.equal(spec.status, 200);
    assert.equal(spec.body.openapi, '3.0.3');

    const keys = await api.call('GET', '/api/integrations/keys', { token });
    assert.ok(keys.body.some((x: { lastUsedAt: number | null }) => x.lastUsedAt !== null));
  });

  it('hides the address when the panel is closed', async () => {
    const k = (await api.call('POST', '/api/integrations/keys', { token, body: { name: 'B' } })).body.key as string;
    const open = await api.call('GET', `/api/v1/servers/${serverId}`, bearer(k));
    assert.equal(typeof open.body.address, 'string');
    assert.equal((await api.call('PUT', '/api/access', { token, body: { publicPanel: false } })).status, 200);
    const closed = await api.call('GET', `/api/v1/servers/${serverId}`, bearer(k));
    assert.equal(closed.status, 200);
    assert.equal(closed.body.address, null);
    assert.equal((await api.call('GET', `/badge/servers/${serverId}.svg`)).status, 404);
    assert.equal((await api.call('GET', `/widget/servers/${serverId}`)).status, 404);
    await api.call('PUT', '/api/access', { token, body: { publicPanel: true } });
  });

  it('answers 429 with Retry-After beyond the limit of the key', async () => {
    const k = (await api.call('POST', '/api/integrations/keys', { token, body: { name: 'Slow', rateLimit: 2 } })).body.key as string;
    assert.equal((await api.call('GET', '/api/v1/status', bearer(k))).status, 200);
    assert.equal((await api.call('GET', '/api/v1/status', bearer(k))).status, 200);
    const r = await fetch(`${api.base}/api/v1/status`, { headers: { Authorization: `Bearer ${k}` } });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) >= 1);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'rate_limited');
  });

  it('revokes a key at once and writes the journal', async () => {
    const c = await api.call('POST', '/api/integrations/keys', { token, body: { name: 'Temp' } });
    const k = c.body.key as string;
    assert.equal((await api.call('GET', '/api/v1/status', bearer(k))).status, 200);
    assert.equal((await api.call('DELETE', `/api/integrations/keys/${c.body.id}`)).status, 401);
    const d = await api.call('DELETE', `/api/integrations/keys/${c.body.id}`, { token });
    assert.equal(d.status, 200);
    assert.ok(d.body.revokedAt > 0);
    assert.equal((await api.call('GET', '/api/v1/status', bearer(k))).status, 401);
    assert.equal((await api.call('DELETE', '/api/integrations/keys/999999', { token })).status, 404);
    const audit = await api.call('GET', '/api/audit', { token });
    const acts = (audit.body as { action: string; detail: string }[]).map((a) => `${a.action}|${a.detail}`);
    assert.ok(acts.includes('Создан API-ключ|Temp'));
    assert.ok(acts.includes('Отозван API-ключ|Temp'));
  });

  it('serves the badge and the widget without a key', async () => {
    const b = await fetch(`${api.base}/badge/servers/${serverId}.svg`);
    assert.equal(b.status, 200);
    assert.match(b.headers.get('content-type') ?? '', /image\/svg\+xml/);
    assert.match(b.headers.get('cache-control') ?? '', /max-age=(30|60)/);
    const svg = await b.text();
    assert.ok(svg.includes('Mine &lt;b&gt;'));
    assert.ok(!svg.includes('<b>'));
    assert.equal((await fetch(`${api.base}/badge/servers/999999.svg`)).status, 404);

    const w = await fetch(`${api.base}/widget/servers/${serverId}`);
    assert.equal(w.status, 200);
    assert.equal(w.headers.get('x-frame-options'), null);
    assert.match(w.headers.get('content-security-policy') ?? '', /frame-ancestors \*/);
    assert.match(w.headers.get('cache-control') ?? '', /max-age=60/);
    assert.ok((await w.text()).includes('Mine &lt;b&gt;'));
    // other pages stay unframeable
    const h = await fetch(`${api.base}/api/health`);
    assert.equal(h.headers.get('x-frame-options'), 'DENY');
  });
});
