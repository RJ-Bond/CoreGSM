/** Nick onboarding: matching helpers, autocomplete endpoint, nickSeen in the profile, first-seen notice, nick-status. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { distinctNames, levenshtein, similarNames, suggestNames } from '../src/nickMatch.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('nick matching (pure)', () => {
  it('levenshtein', () => {
    assert.equal(levenshtein('vamp', 'vamp'), 0);
    assert.equal(levenshtein('vamp', 'vmap'), 2);
    assert.equal(levenshtein('kitten', 'sitting'), 3);
    assert.equal(levenshtein('', 'abc'), 3);
    assert.ok(levenshtein('abcdef', 'uvwxyz', 2) > 2);
  });
  it('distinct is case-insensitive and keeps order', () => {
    assert.deepEqual(distinctNames(['Vamp', 'vamp', ' ', 'Bat', 'VAMP']), ['Vamp', 'Bat']);
  });
  it('suggestions: prefix first, then substring, limited', () => {
    const c = ['xxVampxx', 'Vamp One', 'bat', 'vampire', 'Vamp One'];
    assert.deepEqual(suggestNames('VAMP', c), ['Vamp One', 'vampire', 'xxVampxx']);
    assert.deepEqual(suggestNames('', c, 2), ['xxVampxx', 'Vamp One']);
    assert.equal(suggestNames('a', Array.from({ length: 40 }, (_, i) => `a${i}`)).length, 25);
    assert.deepEqual(suggestNames('zzz', c), []);
  });
  it('similar names: typo, substring, not itself', () => {
    const c = ['Vamp', 'Vmap', 'vampire lord', 'Totally Other', 'Vamp2'];
    const s = similarNames('vamp', c);
    assert.ok(s.includes('Vmap') && s.includes('Vamp2') && s.includes('vampire lord'));
    assert.ok(!s.includes('Vamp') && !s.includes('Totally Other'));
    assert.equal(similarNames('abc', Array.from({ length: 20 }, (_, i) => `abc${i}`)).length, 5);
  });
});

describe('nick onboarding over the API', () => {
  let api: Api;
  let token = '';
  let vr = 0;
  let other = 0;
  let db: InstanceType<typeof Database>;
  const H = { 'x-internal-token': 'i'.repeat(48) };
  const id = (n: number) => String(200000000000000000n + BigInt(n));
  const suggest = async (q: string, discordId = '') => {
    const r = await api.call('GET', `/internal/discord/nick-suggest?q=${encodeURIComponent(q)}&discordId=${discordId}`, { headers: H });
    assert.equal(r.status, 200);
    return r.body.names as string[];
  };
  const now = Date.now();

  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
    vr = (await api.call('POST', '/api/servers', { token, body: { name: 'VR Main', game: 'vrising', host: '127.0.0.1', port: 9876 } })).body.id;
    other = (await api.call('POST', '/api/servers', { token, body: { name: 'Other', game: 'minecraft', host: '127.0.0.1', port: 25565 } })).body.id;
    db = new Database(api.dbPath);
    const online = db.prepare('INSERT INTO player_now (server_id, name, since) VALUES (?, ?, ?)');
    online.run(other, 'Zed Online', now - 1000);
    online.run(vr, 'Zara Vamp', now - 2000);
    const ses = db.prepare('INSERT INTO player_sessions (server_id, name, joined_at, left_at) VALUES (?, ?, ?, ?)');
    ses.run(vr, 'Zoran Old', now - 3 * 86400_000, now - 3 * 86400_000 + 3600_000);
    ses.run(vr, 'zara vamp', now - 5 * 86400_000, now - 5 * 86400_000 + 3600_000);
    ses.run(vr, 'Zeta Ancient', now - 30 * 86400_000, now - 30 * 86400_000 + 3600_000);
    ses.run(vr, 'Taken Nick', now - 86400_000, now - 86400_000 + 3600_000);
    // an account that already owns "Taken Nick"
    await api.call('POST', '/internal/discord/register', { headers: H, body: { discordId: id(1), displayName: 'Owner', gameNick: 'Taken Nick' } });
  });
  after(async () => {
    db.close();
    await api.stop();
  });

  it('nick-suggest requires the internal token', async () => {
    const r = await api.call('GET', '/internal/discord/nick-suggest?q=z', {});
    assert.equal(r.status, 403);
  });

  it('orders online vrising, other online, recent; distinct; no old or taken names', async () => {
    assert.deepEqual(await suggest('z'), ['Zara Vamp', 'Zed Online', 'Zoran Old']);
    assert.deepEqual(await suggest('ZA'), ['Zara Vamp']);
    assert.deepEqual(await suggest('vamp'), ['Zara Vamp']);
    assert.deepEqual(await suggest('taken'), []);
    assert.deepEqual(await suggest('taken', id(1)), ['Taken Nick']);
    assert.deepEqual(await suggest('zeta'), []);
    const all = await suggest('');
    assert.ok(all.length <= 25 && all.every((n) => n.length <= 100));
  });

  it('profile has nickSeen and lastSeenAt', async () => {
    const reg = (n: number, nick: string) =>
      api.call('POST', '/internal/discord/register', { headers: H, body: { discordId: id(n), displayName: `P${n}`, gameNick: nick } });
    await reg(2, 'never seen');
    await reg(3, 'zoran OLD');
    await reg(4, 'Zed online');
    const p = (n: number) => api.call('GET', `/internal/discord/profile?discordId=${id(n)}`, { headers: H });
    const a = (await p(2)).body;
    assert.equal(a.nickSeen, false);
    assert.equal(a.lastSeenAt, null);
    const b = (await p(3)).body;
    assert.equal(b.nickSeen, true);
    assert.equal(b.lastSeenAt, now - 3 * 86400_000 + 3600_000);
    const c = (await p(4)).body;
    assert.equal(c.nickSeen, false); // player_now alone is not a session
    const none = (await p(99)).body;
    assert.equal(none.found, false);
  });

  it('first-seen notice is created once when the nick is online', async () => {
    db.prepare('INSERT INTO player_sessions (server_id, name, joined_at, left_at) VALUES (?, ?, ?, NULL)').run(vr, 'Hero Open', Date.now() - 1000);
    const put = await api.call('PUT', '/api/me/player', { token, body: { gameNick: 'hero open', bio: '', publicProfile: false } });
    assert.equal(put.status, 200);
    let n = await api.call('GET', '/api/me/notifications', { token });
    const mine = n.body.items.filter((x: any) => x.kind === 'nick_seen');
    assert.equal(mine.length, 1);
    assert.match(mine[0].text, /Мы увидели вас на сервере «VR Main»/);
    assert.equal(mine[0].serverId, vr);
    // setting the nick again does not repeat it
    await api.call('PUT', '/api/me/player', { token, body: { gameNick: 'Hero Open', bio: '', publicProfile: false } });
    n = await api.call('GET', '/api/me/notifications', { token });
    assert.equal(n.body.items.filter((x: any) => x.kind === 'nick_seen').length, 1);
    const cnt = db.prepare("SELECT COUNT(*) AS c FROM account_events WHERE kind = 'nick_seen'").get() as { c: number };
    assert.equal(cnt.c, 1);
  });

  it('nick-status: seen line and similar names', async () => {
    let r = await api.call('GET', '/api/me/nick-status', { token });
    assert.equal(r.status, 200);
    assert.equal(r.body.seen, true);
    assert.equal(r.body.nick, 'Hero Open');
    assert.equal(typeof r.body.lastSeenAt, 'number');

    await api.call('PUT', '/api/me/player', { token, body: { gameNick: 'Zara Vmap', bio: '', publicProfile: false } });
    r = await api.call('GET', '/api/me/nick-status', { token });
    assert.equal(r.body.seen, false);
    assert.equal(r.body.lastSeenAt, null);
    assert.ok(r.body.similar.includes('Zara Vamp'), JSON.stringify(r.body));
    assert.ok(!r.body.similar.includes('Taken Nick'));
    assert.ok(r.body.similar.length <= 5);

    const anon = await api.call('GET', '/api/me/nick-status', {});
    assert.equal(anon.status, 401);
  });
});
