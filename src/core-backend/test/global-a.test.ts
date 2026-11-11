import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { bus } from '../src/events.ts';
import { percentile, rating, RUM_LIMITS } from '../src/monitoring/rumLogic.ts';
import { isHistoryKey } from '../src/admin/portableSettings.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('the bus of events', () => {
  it('tells every listener, and a listener that throws does not stop the others', () => {
    const seen: number[] = [];
    const off1 = bus.on('server.polled', () => { throw new Error('a broken listener'); });
    const off2 = bus.on('server.polled', (e) => seen.push(e.id));
    bus.emit('server.polled', { id: 7, online: true, players: 3 });
    off1();
    off2();
    assert.deepEqual(seen, [7]);
    bus.emit('server.polled', { id: 8, online: true, players: 0 });
    assert.deepEqual(seen, [7], 'a listener that left hears nothing more');
  });
});

describe('the speed of the pages: the arithmetic', () => {
  it('takes the nearest-rank percentile and rates a value against the limits of web.dev', () => {
    assert.equal(percentile([], 75), null);
    assert.equal(percentile([100], 75), 100);
    assert.equal(percentile([1, 2, 3, 4], 75), 3);
    assert.equal(rating('LCP', RUM_LIMITS.LCP[0]), 'good');
    assert.equal(rating('LCP', RUM_LIMITS.LCP[0] + 1), 'needs');
    assert.equal(rating('CLS', 0.3), 'poor');
  });
});

describe('the settings people set are the ones that get a history', () => {
  it('never a secret or a counter', () => {
    assert.ok(isHistoryKey('brand_color'));
    assert.ok(isHistoryKey('public_panel'));
    assert.ok(!isHistoryKey('bot_token'));
    assert.ok(!isHistoryKey('smtp_pass'));
    assert.ok(!isHistoryKey('backup_verify'));
  });
});

describe('api: the history of the settings, the speed of the pages, the second step of the public API, the data of an account', () => {
  let api: Api;
  let token = '';
  let id = 0;
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
    const c = await api.call('POST', '/api/servers', { token, body: { name: 'History test', game: 'vrising', host: '127.0.0.1', port: 25597 } });
    id = c.body.id;
  });
  after(async () => { await api.stop(); });

  it('writes down who changed a setting, from what to what, and puts it back', async () => {
    assert.equal((await api.call('GET', '/api/settings/history')).status, 401);
    const before = ((await api.call('GET', '/api/access')).body as { brand: { color: string } }).brand.color;
    assert.equal((await api.call('PUT', '/api/branding', { token, body: { name: 'History', color: '#112233' } })).status, 200);
    const list = (await api.call('GET', '/api/settings/history', { token })).body as { id: number; actor: string | null; key: string; from: string | null; to: string | null }[];
    const row = list.find((r) => r.key === 'brand_color');
    assert.ok(row, 'the change of the colour is in the history');
    assert.equal(row.to, '#112233');
    assert.ok(row.actor && row.actor.length > 0, 'the person who did it is named');
    assert.equal((await api.call('POST', `/api/settings/history/${row.id}/revert`)).status, 401);
    assert.equal((await api.call('POST', `/api/settings/history/${row.id}/revert`, { token })).status, 200);
    const now = ((await api.call('GET', '/api/access')).body as { brand: { color: string } }).brand.color;
    assert.equal(now, before, 'the colour is what it was');
    const after2 = (await api.call('GET', '/api/settings/history', { token })).body as { key: string }[];
    assert.ok(after2.filter((r) => r.key === 'brand_color').length >= 2, 'the revert is a change of its own');
    assert.equal((await api.call('POST', '/api/settings/history/999999/revert', { token })).status, 404);
  });

  it('keeps the numbers of a page and says them back per page, nothing about the person', async () => {
    const post = (body: unknown) => fetch(`${api.base}/api/rum`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ route: 'servers', m: { LCP: 1800, CLS: 0.05, INP: 120 } })).status, 204);
    assert.equal((await post({ route: 'servers', m: { LCP: 3000 } })).status, 204);
    assert.equal((await post({ route: 'not-a-page', m: { LCP: 1 } })).status, 204, 'a wrong page is answered as the others and not stored');
    assert.equal((await post({ route: 'servers', m: { LCP: -5 } })).status, 204);
    assert.equal((await api.call('GET', '/api/rum/summary')).status, 401);
    const s = (await api.call('GET', '/api/rum/summary', { token })).body as { enabled: boolean; rows: { route: string; metric: string; n: number; p75: number; rating: string }[] };
    assert.equal(s.enabled, true);
    const lcp = s.rows.find((r) => r.route === 'servers' && r.metric === 'LCP');
    assert.ok(lcp);
    assert.equal(lcp.n, 2);
    assert.equal(lcp.p75, 3000);
    assert.equal(lcp.rating, 'needs');
    assert.ok(!s.rows.some((r) => r.route === 'not-a-page'));
  });

  it('answers the new calls of the public API with the same errors and shapes', async () => {
    const k = await api.call('POST', '/api/integrations/keys', { token, body: { name: 'v2 test' } });
    assert.equal(k.status, 201);
    const key = (k.body as { key: string }).key;
    const get = async (path: string) => {
      const r = await fetch(`${api.base}${path}`, { headers: { authorization: `Bearer ${key}` } });
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    };
    const h = await get(`/api/v1/servers/${id}/history?hours=6`);
    assert.equal(h.status, 200);
    assert.equal(h.body.serverId, id);
    assert.equal(h.body.hours, 6);
    assert.ok(Array.isArray(h.body.points));
    assert.equal((await get(`/api/v1/servers/${id}/history?hours=9999`)).body.hours, 168, 'the period is capped');
    const e = await get(`/api/v1/servers/${id}/events`);
    assert.equal(e.status, 200);
    assert.ok(Array.isArray(e.body.events));
    const p = await get(`/api/v1/servers/${id}/players`);
    assert.equal(p.status, 200);
    assert.equal(typeof p.body.count, 'number');
    const c = await get('/api/v1/community?days=3');
    assert.equal(c.status, 200);
    assert.equal(c.body.days, 3);
    assert.ok(Array.isArray(c.body.top));
    const missing = await get('/api/v1/servers/999999/history');
    assert.equal(missing.status, 404);
    assert.equal((missing.body.error as { code: string }).code, 'not_found');
    assert.equal((await fetch(`${api.base}/api/v1/community`)).status, 401, 'a key is needed');
    const spec = (await (await fetch(`${api.base}/api/v1/openapi.json`)).json()) as { paths: Record<string, unknown> };
    for (const path of ['/api/v1/servers/{id}/history', '/api/v1/servers/{id}/events', '/api/v1/servers/{id}/players', '/api/v1/community']) assert.ok(spec.paths[path], `${path} is described`);
  });

  it('tells a person what the panel keeps about them, in kinds, with how many and for how long', async () => {
    assert.equal((await api.call('GET', '/api/me/data-summary')).status, 401);
    const s = (await api.call('GET', '/api/me/data-summary', { token })).body as { key: string; count: number; days: number | null }[];
    assert.ok(Array.isArray(s));
    const kinds = s.map((r) => r.key);
    for (const k of ['account', 'preferences', 'favourites', 'devices', 'journal']) assert.ok(kinds.includes(k), `${k} is listed`);
    assert.equal(s.find((r) => r.key === 'account')?.count, 1);
    assert.ok((s.find((r) => r.key === 'journal')?.days ?? 0) > 0, 'the journal has a time it is kept for');
  });
});
