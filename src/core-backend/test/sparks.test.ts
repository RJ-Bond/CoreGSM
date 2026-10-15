/** The server list's sparklines in one request: GET /api/servers/sparks. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('api: sparklines of all servers', () => {
  let api: Api;
  let a = 0;
  let b = 0;
  before(async () => {
    api = await startBackend();
    await setupAdmin(api);
    const db = new Database(api.dbPath);
    const now = Date.now();
    const add = (name: string) => Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES (?, 'minecraft', '127.0.0.1', 25565, ?)").run(name, now).lastInsertRowid);
    a = add('Alpha');
    b = add('Beta');
    const h = db.prepare('INSERT INTO history (server_id, ts, online, players) VALUES (?, ?, ?, ?)');
    // Alpha: busy an hour ago, down 10 minutes ago; Beta: one old sample outside the window
    h.run(a, now - 4_500_000, 1, 4); // the middle of a 30-minute bucket, away from its edges
    h.run(a, now - 4_490_000, 1, 9);
    h.run(a, now - 600_000, 0, 0);
    h.run(b, now - 30 * 3_600_000, 1, 5);
    db.close();
  });
  after(async () => { await api.stop(); });

  it('48 buckets per server: the busiest moment of each, empty buckets null, outages marked', async () => {
    const r = await api.call('GET', '/api/servers/sparks?hours=24');
    assert.equal(r.status, 200);
    assert.equal(r.body.points, 48);
    const s = r.body.servers[a] as { players: (number | null)[]; down: boolean[] };
    assert.equal(s.players.length, 48);
    assert.equal(s.down.length, 48);
    assert.ok(s.players.includes(9), 'the bucket keeps its maximum');
    assert.ok(!s.players.includes(4));
    assert.equal(s.players.filter((v) => v != null).length, 2);
    assert.equal(s.down.filter(Boolean).length, 1);
    assert.equal(s.down[47] || s.down[46], true, 'the outage is at the end');
    assert.equal(r.body.servers[b], undefined, 'samples older than the window are not shown');
  });

  it('the server page gets the usual players per hour of the week (two days behind an hour at least)', async () => {
    const db = new Database(api.dbPath);
    const now = Date.now();
    const h = db.prepare('INSERT INTO history (server_id, ts, online, players) VALUES (?, ?, 1, ?)');
    // the same hour one and two weeks before the shown day: 10 and 20 players
    h.run(a, now - 7 * 86_400_000 - 2 * 86_400_000, 10);
    h.run(a, now - 14 * 86_400_000 - 2 * 86_400_000, 20);
    db.close();
    const d = (await api.call('GET', `/api/servers/${a}/details?hours=24`)).body;
    assert.equal(d.baseline.length, 168);
    const t = new Date(Date.now() - 2 * 86_400_000);
    assert.equal(d.baseline[t.getUTCDay() * 24 + t.getUTCHours()], 15);
    assert.equal(d.baseline.filter((v: number | null) => v != null).length, 1);
    assert.equal((await api.call('GET', `/api/servers/${a}/details?hours=720`)).body.baseline, null, 'not for 30 days');
  });

  it('a private panel hides them from guests', async () => {
    const db = new Database(api.dbPath);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('public_panel', '0')").run();
    db.close();
    const r = await api.call('GET', '/api/servers/sparks');
    assert.equal(r.status, 401);
  });
});
