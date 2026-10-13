/** Main page data: GET /api/overview and GET /api/events/recent. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const BUCKET = 900_000; // 24 h / 96

describe('api: overview and recent events', () => {
  let api: Api;
  let token = '';
  let a = 0;
  let b = 0;
  let base = 0;
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
    const db = new Database(api.dbPath);
    const now = Date.now();
    base = Math.floor((now - 3 * 3_600_000) / BUCKET) * BUCKET + 1000;
    const add = (name: string) => Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES (?, 'minecraft', '127.0.0.1', 25565, ?)").run(name, now).lastInsertRowid);
    a = add('Alpha');
    b = add('Beta');
    const h = db.prepare('INSERT INTO history (server_id, ts, online, players) VALUES (?, ?, ?, ?)');
    h.run(a, base, 1, 3);
    h.run(a, base + 5000, 1, 5); // the last sample of the bucket wins
    h.run(b, base, 1, 4);
    h.run(a, base + BUCKET, 0, 0); // Alpha goes down in the next bucket
    h.run(b, base + BUCKET, 1, 7);
    const st = db.prepare('INSERT INTO status (server_id, online, players, max_players, updated_at) VALUES (?, ?, ?, ?, ?)');
    st.run(a, 0, 0, 20, now);
    st.run(b, 1, 7, 20, now);
    db.close();
  });
  after(async () => { await api.stop(); });

  it('sums the last sample per server per bucket and marks the peak', async () => {
    const r = await api.call('GET', '/api/overview?hours=24');
    assert.equal(r.status, 200);
    const pts = r.body.points as { ts: number; players: number; online: number }[];
    assert.equal(pts.length, 2);
    assert.deepEqual(pts.map((p) => [p.players, p.online]), [[9, 2], [7, 1]]);
    assert.equal(pts[0].ts, Math.floor(base / BUCKET) * BUCKET);
    assert.deepEqual(r.body.peak, { ts: pts[0].ts, players: 9 });
    assert.deepEqual(r.body.totals, { players: 7, servers: 2, online: 1 });
    assert.ok(Array.isArray(r.body.maintenance));
  });

  it('is public like /api/status and clamps the period', async () => {
    const r = await api.call('GET', '/api/overview?hours=99999');
    assert.equal(r.status, 200);
    assert.equal(r.body.hours, 168);
    const n = await api.call('GET', '/api/overview?hours=abc');
    assert.equal(n.body.hours, 24);
  });

  it('lists recent events of all servers, newest first, with a limit', async () => {
    const r = await api.call('GET', '/api/events/recent?limit=8');
    assert.equal(r.status, 200);
    const ev = r.body as { ts: number; serverId: number; serverName: string; type: string; players?: number }[];
    const down = ev.find((e) => e.type === 'down');
    assert.ok(down);
    assert.equal(down.serverId, a);
    assert.equal(down.serverName, 'Alpha');
    const peak = ev.filter((e) => e.type === 'peak');
    assert.equal(peak.length, 2);
    assert.equal(peak.find((e) => e.serverId === b)?.players, 7);
    for (let i = 1; i < ev.length; i++) assert.ok(ev[i - 1].ts >= ev[i].ts);
    const one = await api.call('GET', '/api/events/recent?limit=1');
    assert.equal((one.body as unknown[]).length, 1);
  });

  it('shows a maintenance window as an event and in the outlook', async () => {
    const now = Date.now();
    const c = await api.call('POST', '/api/maintenance', { token, body: { serverId: b, name: 'Patch', startTs: now - 60_000, endTs: now + 3_600_000, repeat: 'none' } });
    assert.equal(c.status, 201);
    const ev = (await api.call('GET', '/api/events/recent?limit=20')).body as { type: string; serverId: number; name?: string }[];
    assert.ok(ev.some((e) => e.type === 'maintenance' && e.serverId === b && e.name === 'Patch'));
    const o = (await api.call('GET', '/api/overview')).body.maintenance as { active: boolean; name: string; serverName: string }[];
    assert.equal(o[0].active, true);
    assert.equal(o[0].serverName, 'Beta');
  });
});
