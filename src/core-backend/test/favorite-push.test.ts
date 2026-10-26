import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_FAV_PREFS, FAV_GAP_MS, favText, fullAt, mayPushFav, nextFavTrack, wantsFav, type FavTrack } from '../src/favoritePushLogic.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const obs = (players: number, maxPlayers = 20, online = true) => ({ online, players, maxPlayers });

describe('favourite push logic', () => {
  it('brings no event on the first observation', () => {
    assert.deepEqual(nextFavTrack(null, obs(20)).events, []);
    assert.deepEqual(nextFavTrack(null, obs(0, 20, false)).events, []);
    assert.equal(nextFavTrack(null, obs(20)).next.full, true);
  });

  it('tells when a server comes back and when it goes down', () => {
    let t: FavTrack = nextFavTrack(null, obs(5)).next;
    const down = nextFavTrack(t, obs(0, 20, false));
    assert.deepEqual(down.events, ['down']);
    t = down.next;
    assert.deepEqual(nextFavTrack(t, obs(0, 20, false)).events, []);
    const up = nextFavTrack(t, obs(3));
    assert.deepEqual(up.events, ['online']);
    assert.equal(up.next.online, true);
  });

  it('tells about a free slot once a full server has room, and not again until it was full again', () => {
    let t = nextFavTrack(null, obs(20)).next;
    assert.deepEqual(nextFavTrack(t, obs(20)).events, []);
    const freed = nextFavTrack(t, obs(19));
    assert.deepEqual(freed.events, ['free_slot']);
    t = freed.next;
    assert.deepEqual(nextFavTrack(t, obs(18)).events, []);
    assert.deepEqual(nextFavTrack(t, obs(10)).events, []);
    t = nextFavTrack(t, obs(20)).next;
    assert.equal(t.full, true);
    assert.deepEqual(nextFavTrack(t, obs(15)).events, ['free_slot']);
  });

  it('keeps the full state inside the hysteresis gap', () => {
    const opts = { fullRatio: 0.9, releaseGap: 2 };
    // 20 slots, full from 18, released at 15 or less
    let t = nextFavTrack(null, obs(18), opts).next;
    assert.equal(t.full, true);
    for (const p of [17, 16]) {
      const r = nextFavTrack(t, obs(p), opts);
      assert.deepEqual(r.events, []);
      t = r.next;
      assert.equal(t.full, true);
    }
    assert.deepEqual(nextFavTrack(t, obs(15), opts).events, ['free_slot']);
  });

  it('never calls a server without a known limit full', () => {
    assert.equal(fullAt(0), 0);
    assert.equal(nextFavTrack(null, obs(50, 0)).next.full, false);
    assert.equal(fullAt(20), 20);
    assert.equal(fullAt(20, 0.9), 18);
    assert.equal(fullAt(20, 0.1), 10);
  });

  it('does not report a free slot on the way back from an outage', () => {
    const full = nextFavTrack(null, obs(20)).next;
    const down = nextFavTrack(full, obs(0, 20, false));
    const back = nextFavTrack(down.next, obs(4));
    assert.deepEqual(back.events, ['online']);
    assert.equal(back.next.full, false);
  });

  it('spaces the pushes of one pair', () => {
    assert.equal(mayPushFav('online', undefined, 1000), true);
    assert.equal(mayPushFav('online', 1000, 1000 + FAV_GAP_MS.online - 1), false);
    assert.equal(mayPushFav('online', 1000, 1000 + FAV_GAP_MS.online), true);
    assert.ok(FAV_GAP_MS.free_slot >= FAV_GAP_MS.online);
  });

  it('knows the defaults and the texts', () => {
    assert.deepEqual(DEFAULT_FAV_PREFS, { online: true, freeSlot: true, down: false });
    assert.equal(wantsFav(DEFAULT_FAV_PREFS, 'down'), false);
    assert.equal(wantsFav(DEFAULT_FAV_PREFS, 'free_slot'), true);
    assert.match(favText('free_slot', 'S', 19, 20), /19\/20/);
    assert.match(favText('online', 'S', 0, 0), /«S»/);
  });
});

describe('api: favourite push settings', () => {
  let api: Api;
  let token = '';
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('needs a login, has defaults and saves changes', async () => {
    assert.equal((await api.call('GET', '/api/me/favorite-push')).status, 401);
    assert.equal((await api.call('PUT', '/api/me/favorite-push', { body: { down: true } })).status, 401);
    const g = await api.call('GET', '/api/me/favorite-push', { token });
    assert.equal(g.status, 200);
    assert.deepEqual({ online: g.body.online, freeSlot: g.body.freeSlot, down: g.body.down }, { online: true, freeSlot: true, down: false });
    assert.equal(g.body.devices, 0);
    assert.equal((await api.call('PUT', '/api/me/favorite-push', { token, body: { down: 'yes' } })).status, 400);
    const p = await api.call('PUT', '/api/me/favorite-push', { token, body: { down: true, online: false } });
    assert.equal(p.status, 200);
    assert.deepEqual({ online: p.body.online, freeSlot: p.body.freeSlot, down: p.body.down }, { online: false, freeSlot: true, down: true });
    const again = await api.call('GET', '/api/me/favorite-push', { token });
    assert.equal(again.body.down, true);
    assert.equal(again.body.online, false);
  });
});
