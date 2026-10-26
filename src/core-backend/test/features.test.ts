import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildEmbed, type EmbedServer } from '../src/embed.ts';
import { GAME_PROFILES, gameLabel } from '../src/games.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const srv = (game: string): EmbedServer => ({
  name: 'S', game, address: 'h:1', hasStatus: true, online: true, players: 1, maxPlayers: 10, map: 'World', version: null, ping: 10, playerNames: [], error: null, updatedAt: 0,
});

describe('game profiles', () => {
  it('covers every game with a label and a port', () => {
    assert.ok(GAME_PROFILES.length >= 26);
    for (const p of GAME_PROFILES) {
      assert.ok(p.label && p.defaultPort > 0, p.id);
      assert.equal(gameLabel(p.id), p.label);
    }
    assert.equal(gameLabel('unknown_game'), 'unknown_game');
  });

  it('hides the map field only for games without a map', () => {
    const has = (game: string) => buildEmbed(srv(game), 100, 60).fields!.some((f) => /Карта/.test(f.name));
    assert.equal(has('vrising'), false);
    assert.equal(has('minecraft'), false);
    assert.equal(has('counterstrike2'), true);
    assert.equal(has('some_custom_game'), true);
  });
});

describe('api: games, subscriptions, notifications, deliveries', () => {
  let api: Api;
  let token = '';
  const internal = { 'x-internal-token': 'i'.repeat(48) };
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('serves the game profiles without authentication', async () => {
    const r = await api.call('GET', '/api/games');
    assert.equal(r.status, 200);
    const v = (r.body as { id: string; queryPortHint?: string; fields: object }[]).find((g) => g.id === 'vrising')!;
    assert.match(v.queryPortHint!, /\+ 1/);
    assert.deepEqual(v.fields, { map: false, mode: false, version: true, players: true });
  });

  it('subscribes, lists and unsubscribes', async () => {
    const c = await api.call('POST', '/api/servers', { token, body: { name: 'Sub', game: 'minecraft', host: '127.0.0.1', port: 25570 } });
    const id = c.body.id as number;
    assert.equal((await api.call('GET', '/api/me/subscriptions')).status, 401);
    assert.equal((await api.call('PUT', `/api/servers/${id}/subscription`, { token, body: { kinds: ['bogus'] } })).status, 400);
    assert.equal((await api.call('PUT', '/api/servers/99999/subscription', { token, body: { kinds: [] } })).status, 404);
    const put = await api.call('PUT', `/api/servers/${id}/subscription`, { token, body: { kinds: ['went_down', 'free_slot'] } });
    assert.deepEqual(put.body, { serverId: id, kinds: ['free_slot', 'went_down'] });
    const list = await api.call('GET', '/api/me/subscriptions', { token });
    assert.deepEqual(list.body, [{ serverId: id, kinds: ['free_slot', 'went_down'] }]);
    await api.call('PUT', `/api/servers/${id}/subscription`, { token, body: { kinds: [] } });
    assert.deepEqual((await api.call('GET', '/api/me/subscriptions', { token })).body, []);
  });

  it('has an empty inbox and reports the unread count in /api/me', async () => {
    const n = await api.call('GET', '/api/me/notifications?unread=1', { token });
    assert.equal(n.status, 200);
    assert.deepEqual(n.body, { unread: 0, items: [] });
    assert.equal((await api.call('GET', '/api/me', { token })).body.unreadNotifications, 0);
    assert.equal((await api.call('POST', '/api/me/notifications/read', { token, body: {} })).status, 400);
    assert.equal((await api.call('POST', '/api/me/notifications/read', { token, body: { all: true } })).body.unread, 0);
  });

  it('queues an alert as a delivery, backs off on failure, dies after 8 attempts and can be retried', async () => {
    assert.equal((await api.call('GET', '/api/deliveries')).status, 401);
    await api.call('PUT', '/api/alerts', { token, body: { channelId: '123456789012345678' } });
    assert.equal((await api.call('POST', '/api/alerts/test', { token })).status, 200);
    // quiet hours are stored; the window that covers the whole day is «now»
    const q = await api.call('PUT', '/api/alerts', { token, body: { quiet: { enabled: true, from: 0, to: 23 } } });
    assert.equal(q.status, 200);
    assert.deepEqual({ ...q.body.quiet, now: undefined }, { enabled: true, from: 0, to: 23, now: undefined });
    assert.equal((await api.call('PUT', '/api/alerts', { token, body: { quiet: { enabled: true, from: 25, to: 1 } } })).status, 400);
    await api.call('PUT', '/api/alerts', { token, body: { quiet: { enabled: false, from: 23, to: 8 } } });
    const list = await api.call('GET', '/api/deliveries?kind=alert&status=pending', { token });
    // empty filters (the panel sent ?status=&kind=) mean «no filter», not a 400
    assert.equal((await api.call('GET', '/api/deliveries?status=&kind=&limit=30', { token })).status, 200);
    assert.equal((await api.call('GET', '/api/deliveries?status=nonsense', { token })).status, 400);
    assert.equal(list.body.items.length, 1);
    const id = list.body.items[0].id as number;

    const pend = await api.call('GET', '/internal/deliveries/pending?kinds=alert', { headers: internal });
    assert.equal(pend.body.length, 1);
    assert.equal(pend.body[0].target, '123456789012345678');

    const fail = await api.call('PATCH', `/internal/deliveries/${id}`, { headers: internal, body: { ok: false, error: 'нет прав' } });
    assert.equal(fail.status, 200);
    let row = (await api.call('GET', '/api/deliveries?kind=alert', { token })).body.items[0];
    assert.equal(row.status, 'error');
    assert.equal(row.attempts, 1);
    assert.equal(row.lastError, 'нет прав');
    assert.ok(row.nextTryAt > Date.now());
    // not due yet: the bot gets nothing
    assert.equal((await api.call('GET', '/internal/deliveries/pending?kinds=alert', { headers: internal })).body.length, 0);

    for (let i = 0; i < 7; i++) await api.call('PATCH', `/internal/deliveries/${id}`, { headers: internal, body: { ok: false, error: 'нет прав' } });
    row = (await api.call('GET', '/api/deliveries?status=dead', { token })).body.items[0];
    assert.equal(row.attempts, 8);
    // the alert history in the panel shows the failure
    const alerts = await api.call('GET', '/api/alerts', { token });
    assert.equal(alerts.body.recent[0].status, 'error');

    assert.equal((await api.call('POST', '/api/deliveries/999999/retry', { token })).status, 404);
    assert.equal((await api.call('POST', `/api/deliveries/${id}/retry`, { token })).status, 200);
    assert.equal((await api.call('POST', `/api/deliveries/${id}/retry`, { token })).status, 409);
    const again = await api.call('GET', '/internal/deliveries/pending?kinds=alert', { headers: internal });
    assert.equal(again.body.length, 1);
    await api.call('PATCH', `/internal/deliveries/${id}`, { headers: internal, body: { ok: true } });
    assert.equal((await api.call('GET', '/api/deliveries?status=sent', { token })).body.items.length, 1);
  });
});
