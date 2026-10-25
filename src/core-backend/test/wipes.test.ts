/** The wipe scenario: the texts (pure) and /api/servers/:id/wipes, /api/wipes/:id. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fill, leadText } from '../src/wipeLogic.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('wipe texts', () => {
  it('says how long is left', () => {
    assert.equal(leadText(10), '10 мин');
    assert.equal(leadText(60), '1 ч');
    assert.equal(leadText(90), '1 ч 30 мин');
    assert.equal(leadText(1440), '1 дн');
    assert.equal(leadText(2880), '2 дн');
  });

  it('fills the known placeholders and leaves the others', () => {
    assert.equal(fill('{server}: сид {seed} ({date}, {time}) {other}', { server: 'Rust', seed: '42', date: '1 ноября', time: '06:00' }), 'Rust: сид 42 (1 ноября, 06:00) {other}');
  });
});

describe('api: wipe scenarios', () => {
  let api: Api;
  let admin = '';
  let serverId = 0;
  const body = (over: Record<string, unknown> = {}) => ({
    name: 'Вайп ноября',
    wipeAt: Date.now() + 3 * 86_400_000,
    announceMin: [10, 1440, 60, 60],
    sayMin: [10],
    channelId: '',
    durationMin: 15,
    commands: ['server.seed {seed}', 'server.writecfg'],
    seedMode: 'random',
    seed: '',
    seasonName: 'Сезон {date}',
    newsChannelId: '',
    newsTitle: '',
    newsText: '',
    mention: 'none',
    ...over,
  });
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    const s = await api.call('POST', '/api/servers', { token: admin, body: { name: 'Rust', game: 'minecraft', host: '127.0.0.1', port: 25565 } });
    serverId = s.body.id;
  });
  after(async () => { await api.stop(); });

  it('needs a signed-in user', async () => {
    assert.equal((await api.call('GET', `/api/servers/${serverId}/wipes`)).status, 401);
  });

  it('plans a wipe: announcements sorted, without repeats', async () => {
    const r = await api.call('POST', `/api/servers/${serverId}/wipes`, { token: admin, body: body() });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.announceMin, [1440, 60, 10]);
    assert.equal(r.body.status, 'scheduled');
    const l = await api.call('GET', `/api/servers/${serverId}/wipes`, { token: admin });
    assert.equal(l.body.length, 1);
  });

  it('refuses a wipe in the past and an empty name', async () => {
    const past = await api.call('POST', `/api/servers/${serverId}/wipes`, { token: admin, body: body({ wipeAt: Date.now() - 1000 }) });
    assert.equal(past.status, 400);
    assert.equal(past.body.code, 'wipe_past');
    const bad = await api.call('POST', `/api/servers/${serverId}/wipes`, { token: admin, body: body({ name: '' }) });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'wipe_bad');
    assert.equal((await api.call('POST', '/api/servers/9999/wipes', { token: admin, body: body() })).status, 404);
  });

  it('changes a planned wipe, cancels it and removes it from the list', async () => {
    const id = (await api.call('GET', `/api/servers/${serverId}/wipes`, { token: admin })).body[0].id;
    const put = await api.call('PUT', `/api/wipes/${id}`, { token: admin, body: body({ name: 'Новое имя', seedMode: 'fixed', seed: '12345' }) });
    assert.equal(put.status, 200);
    assert.equal(put.body.name, 'Новое имя');
    assert.equal(put.body.seed, '12345');
    assert.equal((await api.call('DELETE', `/api/wipes/${id}`, { token: admin })).status, 200);
    assert.equal((await api.call('GET', `/api/servers/${serverId}/wipes`, { token: admin })).body[0].status, 'cancelled');
    // a cancelled scenario can no longer be changed
    const again = await api.call('PUT', `/api/wipes/${id}`, { token: admin, body: body() });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'wipe_locked');
    assert.equal((await api.call('DELETE', `/api/wipes/${id}`, { token: admin })).status, 200);
    assert.deepEqual((await api.call('GET', `/api/servers/${serverId}/wipes`, { token: admin })).body, []);
    assert.equal((await api.call('DELETE', `/api/wipes/${id}`, { token: admin })).status, 404);
  });
});
