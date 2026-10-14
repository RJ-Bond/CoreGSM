/** V Rising rank ladder and achievements: pure thresholds + the API over a real backend with seeded sessions. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { nextRank, rankForHours, rankProgress, VR_RANKS } from '../src/ranks.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const H = 3600_000;

describe('rank ladder (pure)', () => {
  it('has the eight ranks in order', () => {
    assert.deepEqual(VR_RANKS.map((r) => r.minHours), [0, 10, 30, 70, 150, 310, 630, 1270]);
    assert.equal(VR_RANKS[0].id, 'awakened');
    assert.equal(VR_RANKS[7].id, 'progenitor');
  });
  it('picks the rank by hours at the boundaries', () => {
    assert.equal(rankForHours(0).id, 'awakened');
    assert.equal(rankForHours(9.99).id, 'awakened');
    assert.equal(rankForHours(10).id, 'wanderer');
    assert.equal(rankForHours(29.9).id, 'wanderer');
    assert.equal(rankForHours(30).id, 'hunter');
    assert.equal(rankForHours(1269).id, 'elder');
    assert.equal(rankForHours(5000).id, 'progenitor');
  });
  it('next rank and progress', () => {
    assert.equal(nextRank(0)?.id, 'wanderer');
    assert.equal(nextRank(1270), null);
    assert.equal(rankProgress(0), 0);
    assert.equal(rankProgress(5), 0.5);
    assert.equal(rankProgress(50), 0.5);
    assert.equal(rankProgress(2000), 1);
  });
});

describe('V Rising over the API', () => {
  let api: Api;
  let token = '';
  let a = 0;
  let b = 0;
  let db: InstanceType<typeof Database>;
  const put = (body: object) => api.call('PUT', '/api/me/player', { token, body });
  const ach = async () => {
    const r = await api.call('GET', '/api/me/achievements/vrising', { token });
    assert.equal(r.status, 200);
    return new Map<string, any>(r.body.map((x: any) => [x.id, x]));
  };
  const ses = (server: number, name: string, from: number, to: number | null) =>
    db.prepare('INSERT INTO player_sessions (server_id, name, joined_at, left_at) VALUES (?, ?, ?, ?)').run(server, name, from, to);

  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
    await api.call('PUT', '/api/me/prefs', { token, body: { timezone: 'UTC' } });
    a = (await api.call('POST', '/api/servers', { token, body: { name: 'VR A', game: 'vrising', host: '127.0.0.1', port: 9876 } })).body.id;
    b = (await api.call('POST', '/api/servers', { token, body: { name: 'VR B', game: 'vrising', host: '127.0.0.1', port: 9877 } })).body.id;
    db = new Database(api.dbPath);
  });
  after(async () => {
    db.close();
    await api.stop();
  });

  it('nick-less user has zero hours and the first rank', async () => {
    const r = await api.call('GET', '/api/me/rank', { token });
    assert.equal(r.status, 200);
    assert.equal(r.body.game, 'vrising');
    assert.equal(r.body.hours, 0);
    assert.equal(r.body.rank.id, 'awakened');
    assert.equal(r.body.next.id, 'wanderer');
    assert.equal(r.body.progress, 0);
    assert.equal(r.body.sessions, 0);
    const list = await ach();
    assert.equal(list.size, 16);
    assert.equal(list.get('vr-first-bite').earned, false);
    assert.equal(list.get('vr-first-bite').image, '/vrising/achievements/vr-first-bite.png');
    assert.equal(list.get('vr-first-bite').game, 'vrising');
  });

  it('computes time-of-day, streak and multi-server achievements', async () => {
    await put({ gameNick: 'Vamp', bio: '', publicProfile: true });
    const day0 = Math.floor((Date.now() - 40 * 86400000) / 86400000) * 86400000;
    // 7 days in a row, 10:00-11:00 each; day 0 session spans noon
    for (let i = 0; i < 7; i++) ses(a, 'vamp', day0 + i * 86400000 + 10 * H, day0 + i * 86400000 + (i === 0 ? 12.5 : 11) * H);
    // crosses 03:00, and lasts 7 h (20:00 -> 03:00)
    ses(a, 'Vamp', day0 + 10 * 86400000 + 20 * H, day0 + 11 * 86400000 + 3.5 * H);
    // ends at 05:30
    ses(b, 'VAMP', day0 + 15 * 86400000 + 4 * H, day0 + 15 * 86400000 + 5.5 * H);
    // another player on server A must not count
    ses(a, 'Other', day0 + 3 * 86400000, day0 + 3 * 86400000 + 30 * H);
    // crowd: server B has max 10 and 9 players when joining
    const joinB = day0 + 20 * 86400000 + 14 * H;
    ses(b, 'Vamp', joinB, joinB + H);
    db.prepare('UPDATE status SET max_players = 10 WHERE server_id = ?').run(b);
    db.prepare('INSERT INTO history (server_id, ts, online, players) VALUES (?, ?, 1, 9)').run(b, joinB + 20_000);

    const m = await ach();
    for (const id of ['vr-first-bite', 'vr-night-hunter', 'vr-sun-defier', 'vr-sleepless', 'vr-blood-bond', 'vr-dawn-escape', 'vr-two-realms', 'vr-crowd-lord']) {
      assert.equal(m.get(id).earned, true, id);
      assert.ok(m.get(id).earnedAt > 0, `${id} date`);
    }
    for (const id of ['vr-eternal', 'vr-castle-warden', 'vr-elder', 'vr-long-haul', 'vr-loyal', 'vr-veteran-nights', 'vr-crowned']) {
      assert.equal(m.get(id).earned, false, id);
    }
    assert.equal(m.get('vr-veteran-nights').progress, 10);
    assert.equal(m.get('vr-veteran-nights').target, 50);
    assert.equal(m.get('vr-blood-bond').progress, 7);
    assert.equal(m.get('vr-founder').earned, true); // the admin is the first user
  });

  it('rank, public profile and server page players', async () => {
    const r = await api.call('GET', '/api/me/rank', { token });
    assert.equal(r.body.nick, 'Vamp');
    assert.equal(r.body.sessions, 10);
    assert.ok(r.body.hours === 18.5, String(r.body.hours));
    assert.equal(r.body.rank.id, 'wanderer');
    assert.equal(r.body.next.id, 'hunter');
    assert.ok(r.body.progress > 0.4 && r.body.progress < 0.45, String(r.body.progress)); // (18.5 - 10) / 20
    for (const k of ['id', 'name', 'minHours', 'color', 'image']) assert.ok(k in r.body.rank, k);

    const pub = await api.call('GET', '/api/u/admin');
    assert.equal(pub.status, 200);
    assert.equal(pub.body.rank.id, 'wanderer');
    assert.ok(pub.body.vrAchievements.some((x: any) => x.id === 'vr-first-bite' && x.image.endsWith('.png')));

    db.prepare('INSERT INTO player_now (server_id, name, since) VALUES (?, ?, ?)').run(a, 'vAmP', Date.now() - H);
    db.prepare('INSERT INTO player_now (server_id, name, since) VALUES (?, ?, ?)').run(a, 'Stranger', Date.now() - H);
    const d = await api.call('GET', `/api/servers/${a}/details`, { token });
    const byName = new Map<string, any>(d.body.playersNow.map((p: any) => [p.name, p]));
    assert.equal(byName.get('vAmP').rankId, 'wanderer');
    assert.equal(byName.get('Stranger').rankId, 'awakened');
  });

  it('long day and loyalty achievements; rank never goes down', async () => {
    await put({ gameNick: 'Grinder', bio: '', publicProfile: false });
    const day = Math.floor((Date.now() - 30 * 86400000) / 86400000) * 86400000;
    ses(a, 'Grinder', day, day + 5 * H);
    ses(a, 'Grinder', day + 6 * H, day + 11 * H);
    ses(a, 'Grinder', day + 12 * H, day + 14 * H);
    for (let i = 1; i <= 3; i++) ses(a, 'grinder', day + i * 86400000, day + i * 86400000 + 5 * H);
    const m = await ach();
    assert.equal(m.get('vr-long-haul').earned, true);
    assert.equal(m.get('vr-loyal').earned, true); // 27 h, all on one server
    assert.equal(m.get('vr-two-realms').earned, false);
    assert.equal(m.get('vr-castle-warden').earned, false);
    const r = await api.call('GET', '/api/me/rank', { token });
    assert.equal(r.body.hours, 27);
    assert.equal(r.body.rank.id, 'wanderer');
    // sessions pruned: the rank stays
    db.prepare("DELETE FROM player_sessions WHERE lower(name) = 'grinder'").run();
    const r2 = await api.call('GET', '/api/me/rank', { token });
    assert.equal(r2.body.rank.id, 'wanderer');
    assert.equal(r2.body.hours, 27);
  });
});
