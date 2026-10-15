/** Player analytics of a server: GET /api/servers/:id/analytics and the computation behind it. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const DAY = 86_400_000;

describe('api: server analytics', () => {
  let api: Api;
  let id = 0;
  let now = 0;
  before(async () => {
    api = await startBackend({ TZ: 'UTC' });
    await setupAdmin(api);
    const db = new Database(api.dbPath);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('timezone', 'UTC')").run();
    now = Date.now();
    id = Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('A', 'minecraft', '127.0.0.1', 25565, ?)").run(now).lastInsertRowid);
    // history: busy at 20:00 UTC every day, empty at 08:00
    const h = db.prepare('INSERT INTO history (server_id, ts, online, players) VALUES (?, ?, 1, ?)');
    const today = Math.floor(now / DAY) * DAY;
    for (let d = 1; d <= 10; d++) {
      h.run(id, today - d * DAY + 20 * 3_600_000 + 60_000, 30);
      h.run(id, today - d * DAY + 8 * 3_600_000 + 60_000, 0);
    }
    // visits: Old first came five weeks ago (before the 30-day period), skipped the next week and comes every week
    // since; New came yesterday for 45 minutes
    const s = db.prepare('INSERT INTO player_sessions (server_id, name, joined_at, left_at) VALUES (?, ?, ?, ?)');
    // days away from the 7-day edges of the cohort weeks
    for (const ago of [36, 22, 15, 8, 2]) s.run(id, 'Old', now - ago * DAY, now - ago * DAY + 2 * 3_600_000);
    s.run(id, 'New', now - DAY + 3_600_000, now - DAY + 3_600_000 + 45 * 60_000);
    db.close();
  });
  after(async () => { await api.stop(); });

  it('heatmap: the busiest and the quietest hour and the suggested restart time', async () => {
    const r = await api.call('GET', `/api/servers/${id}/analytics?days=30`);
    assert.equal(r.status, 200);
    const hm = r.body.heatmap;
    assert.equal(hm.cells.length, 7);
    assert.equal(hm.cells[0].length, 24);
    assert.equal(hm.busiest.hour, 20);
    assert.equal(hm.busiest.avg, 30);
    assert.equal(hm.quietest.hour, 8);
    assert.equal(hm.restartHour, 8);
    assert.equal(hm.cells.flat().filter((v: number | null) => v != null).length > 0, true);
  });

  it('summary: unique, new and returning players, visit lengths, top players', async () => {
    const { body } = await api.call('GET', `/api/servers/${id}/analytics?days=30`);
    assert.equal(body.summary.players, 2);
    assert.equal(body.summary.newPlayers, 1);
    assert.equal(body.summary.returning, 1);
    assert.equal(body.summary.visits, 5);
    assert.equal(body.summary.wau, 2);
    assert.equal(body.summary.playerHours, Math.round((4 * 120 + 45) / 60));
    const buckets = Object.fromEntries(body.sessions.map((s: { key: string; count: number }) => [s.key, s.count]));
    assert.equal(buckets.lt60, 1);
    assert.equal(buckets.lt240, 4);
    assert.equal(body.top[0].name, 'Old');
    assert.equal(body.top[0].hours, 8);
    assert.equal(body.daily.length, 30);
  });

  it('weekly retention: the cohort of five weeks ago skipped one week and came back in every week after', async () => {
    const { body } = await api.call('GET', `/api/servers/${id}/analytics?days=7`);
    const c5 = body.cohorts.find((c: { size: number; rates: number[] }) => c.rates.length === 5);
    assert.equal(c5.size, 1);
    assert.deepEqual(c5.rates, [0, 100, 100, 100, 100]);
    assert.equal(body.summary.players, 2, 'both played in the last 7 days');
  });

  it('unknown server: 404; an unexpected period falls back to 30 days', async () => {
    assert.equal((await api.call('GET', '/api/servers/999/analytics')).status, 404);
    assert.equal((await api.call('GET', `/api/servers/${id}/analytics?days=5`)).body.days, 30);
  });
});
