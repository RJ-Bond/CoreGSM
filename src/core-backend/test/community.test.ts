/** The community: GET /api/community and the player card GET /api/players/:name. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { startBackend, setupAdmin, type Api } from './harness.ts';

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe('api: community and player cards', () => {
  let api: Api;
  let a = 0;
  let b = 0;
  let now = 0;
  before(async () => {
    api = await startBackend({ TZ: 'UTC' });
    await setupAdmin(api);
    const db = new Database(api.dbPath);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('timezone', 'UTC')").run();
    now = Date.now();
    const srv = db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES (?, 'minecraft', '127.0.0.1', 25565, ?)");
    a = Number(srv.run('Alpha', now).lastInsertRowid);
    b = Number(srv.run('Beta', now).lastInsertRowid);
    // two days ago both servers were busy in the same 5 minutes: 12 + 9 is the record
    const h = db.prepare('INSERT INTO history (server_id, ts, online, players) VALUES (?, ?, 1, ?)');
    const t = Math.floor((now - 2 * DAY) / 300_000) * 300_000 + 60_000;
    h.run(a, t, 12);
    h.run(b, t + 30_000, 9);
    h.run(a, now - 5 * DAY, 4);
    // visits: Viktor plays every day for a week (a streak), Old came three weeks ago only, Live is on now
    const s = db.prepare('INSERT INTO player_sessions (server_id, name, joined_at, left_at) VALUES (?, ?, ?, ?)');
    for (let d = 0; d < 6; d++) s.run(d % 2 ? b : a, d ? 'Viktor' : 'viktor', now - d * DAY - 3 * HOUR, now - d * DAY - HOUR);
    s.run(a, 'Old', now - 21 * DAY, now - 21 * DAY + HOUR);
    s.run(b, 'Live', now - 10 * 60_000, null);
    db.close();
  });
  after(async () => { await api.stop(); });

  it('community: the record, unique players, the top and the feed', async () => {
    const r = await api.call('GET', '/api/community');
    assert.equal(r.status, 200);
    const c = r.body;
    assert.equal(c.record.players, 21);
    assert.equal(c.now.servers, 2);
    assert.equal(c.players.day, 2); // Viktor (any case) and Live
    assert.equal(c.players.week, 2);
    assert.equal(c.players.month, 3);
    assert.equal(c.players.newWeek, 2); // Old came before the week
    assert.equal(c.top.week[0].hours, 12);
    assert.equal(c.top.week[0].servers, 2);
    assert.equal(c.top.month.length, 3);
    assert.equal(c.feed[0].name, 'Live');
    assert.equal(c.feed[0].online, true);
    assert.equal(c.feed[0].newcomer, true);
    assert.equal(c.feed.find((f: { name: string }) => f.name === 'Viktor').newcomer, false);
    assert.equal(c.heatmap.cells.length, 7);
    assert.equal(c.heatmap.busiest.avg >= 9, true);
  });

  it('player card: hours, servers, streak, any case of the nick', async () => {
    const r = await api.call('GET', '/api/players/VIKTOR');
    assert.equal(r.status, 200);
    const p = r.body;
    assert.equal(p.visits, 6);
    assert.equal(p.hours, 12);
    assert.equal(p.streak, 6);
    assert.equal(p.online, false);
    assert.equal(p.servers.length, 2);
    assert.equal(p.servers[0].hours, 6);
    assert.equal(p.byHour.reduce((n: number, v: number) => n + v, 0), 12);
    assert.equal(p.recent.length, 6);
    const live = await api.call('GET', '/api/players/Live');
    assert.equal(live.body.online, true);
    assert.equal(live.body.lastSeen, null);
  });

  it('an unknown player is a 404 with a code', async () => {
    const r = await api.call('GET', '/api/players/Nobody');
    assert.equal(r.status, 404);
    assert.equal(r.body.code, 'player_not_found');
  });
});
