/** Seasons, the hall of fame and the badges on a player's card. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe('api: seasons', () => {
  let api: Api;
  let token = '';
  let now = 0;
  before(async () => {
    api = await startBackend({ TZ: 'UTC' });
    token = await setupAdmin(api);
    const db = new Database(api.dbPath);
    now = Date.now();
    const a = Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('A', 'rust', '127.0.0.1', 28015, ?)").run(now).lastInsertRowid);
    const s = db.prepare('INSERT INTO player_sessions (server_id, name, joined_at, left_at) VALUES (?, ?, ?, ?)');
    // season 1 (20..5 days ago): Kain first and champion, then Mira, then Lilith; season 2 (from 5 days ago): Mira first
    s.run(a, 'Kain', now - 20 * DAY + HOUR, now - 20 * DAY + 9 * HOUR);
    s.run(a, 'Mira', now - 15 * DAY, now - 15 * DAY + 5 * HOUR);
    s.run(a, 'Lilith', now - 10 * DAY, now - 10 * DAY + 2 * HOUR);
    s.run(a, 'Vlad', now - 9 * DAY, now - 9 * DAY + HOUR);
    s.run(a, 'Mira', now - 5 * DAY + HOUR, now - 5 * DAY + 3 * HOUR);
    db.close();
  });
  after(async () => { await api.stop(); });

  it('a new season closes the previous one; the finished one shows its podium', async () => {
    let r = await api.call('POST', '/api/seasons', { token, body: { name: 'Сезон 1', startsAt: now - 20 * DAY } });
    assert.equal(r.status, 200);
    r = await api.call('POST', '/api/seasons', { token, body: { name: 'Сезон 2', startsAt: now - 5 * DAY } });
    assert.equal(r.body.current.name, 'Сезон 2');
    assert.deepEqual(r.body.current.top.map((p: { name: string }) => p.name), ['Mira']);
    assert.equal(r.body.current.first.name, 'Mira');
    assert.equal(r.body.past.length, 1);
    assert.deepEqual(r.body.past[0].podium.map((p: { name: string }) => p.name), ['Kain', 'Mira', 'Lilith']);
    assert.equal(r.body.past[0].first.name, 'Kain');
    assert.equal(r.body.past[0].endsAt, now - 5 * DAY);
  });

  it('season badges and play achievements on the player card', async () => {
    const kain = (await api.call('GET', '/api/players/kain')).body;
    const has = (p: { achievements: { id: string; earned: boolean }[] }, id: string) => p.achievements.find((a) => a.id === id)!.earned;
    assert.equal(has(kain, 'season-first'), true);
    assert.equal(has(kain, 'season-champion'), true);
    assert.equal(has(kain, 'season-podium'), true);
    assert.equal(has(kain, 'first-step'), true);
    assert.equal(has(kain, 'marathon'), true); // 8 hours in one go
    const mira = (await api.call('GET', '/api/players/mira')).body;
    assert.equal(has(mira, 'season-first'), true);
    assert.equal(has(mira, 'season-champion'), false);
    assert.equal(has(mira, 'season-podium'), true);
    const vlad = (await api.call('GET', '/api/players/vlad')).body;
    assert.equal(has(vlad, 'season-podium'), false);
  });

  it('removing the current season reopens the previous one; only the admin manages seasons', async () => {
    const list = (await api.call('GET', '/api/seasons')).body;
    assert.equal((await api.call('POST', '/api/seasons', { body: { name: 'x' } })).status, 401);
    const r = await api.call('DELETE', `/api/seasons/${list.current.id}`, { token });
    assert.equal(r.body.current.name, 'Сезон 1');
    assert.equal(r.body.past.length, 0);
  });
});
