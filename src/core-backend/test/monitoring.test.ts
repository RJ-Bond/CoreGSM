/**
 * Monitoring: incidents from the poll history, smart alerts and the weekly digest (in-process),
 * and the status page and digest endpoints (a real backend).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const MIN = 60_000;
const DAY = 86_400_000;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-mon-'));
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ??= 'i'.repeat(48);
const { db, setSetting } = await import('../src/db.ts');
const { incidentsSince, downtimeByDay } = await import('../src/incidents.ts');
const { trackSmart } = await import('../src/smartAlerts.ts');
const { buildDigest, digestDue } = await import('../src/digest.ts');

const addServer = (name: string) => Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES (?, 'minecraft', '127.0.0.1', 25565, ?)").run(name, Date.now()).lastInsertRowid);
const hist = db.prepare('INSERT INTO history (server_id, ts, online, players, ping, unconfirmed, maint) VALUES (?, ?, ?, ?, ?, ?, ?)');

describe('incidents', () => {
  it('a confirmed outage is an incident with its length and the players it hit; an unconfirmed miss is not', () => {
    const id = addServer('Inc');
    const t0 = Date.now() - 3 * 3600_000;
    hist.run(id, t0, 1, 12, 30, 0, 0);
    hist.run(id, t0 + MIN, 0, 0, null, 1, 0); // a single unconfirmed miss
    hist.run(id, t0 + 2 * MIN, 1, 13, 30, 0, 0);
    hist.run(id, t0 + 3 * MIN, 0, 0, null, 0, 0); // down for 40 minutes
    hist.run(id, t0 + 43 * MIN, 1, 5, 30, 0, 0);
    hist.run(id, t0 + 60 * MIN, 0, 0, null, 0, 1); // planned work, still going on
    const list = incidentsSince(Date.now() - DAY, id);
    assert.equal(list.length, 2);
    assert.equal(list[0].minutes, 40);
    assert.equal(list[0].playersBefore, 13);
    assert.equal(list[0].planned, false);
    assert.equal(list[1].end, null);
    assert.equal(list[1].planned, true);
    const days = [...downtimeByDay(list).values()];
    assert.equal(Math.round(days.reduce((n, d) => n + d.down, 0)), 40);
    assert.ok(days.reduce((n, d) => n + d.planned, 0) > 100);
  });
});

describe('smart alerts', () => {
  let id = 0;
  before(() => {
    id = addServer('Smart');
    const now = Date.now();
    // four weeks of history around this hour of the week (an hour before to three after, so the checks below
    // never step into an hour without history, whatever the clock): about 20 players
    for (let w = 1; w <= 4; w++) for (let k = -90; k < 180; k += 2) hist.run(id, now - w * 7 * DAY + k * MIN, 1, 20, 40, 0, 0);
    setSetting('alerts_enabled', '1');
    setSetting('alerts_channel', '123456789012345678');
    setSetting('alerts_smart_low', '1');
    setSetting('alerts_smart_full', '1');
  });
  const alerts = (kind: string) => (db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE kind = ?').get(kind) as { n: number }).n;

  it('low online: only after 20 minutes, then once per cooldown', () => {
    const t = Date.now();
    trackSmart(id, { online: true, players: 2, maxPlayers: 40, ping: 40 }, t);
    trackSmart(id, { online: true, players: 2, maxPlayers: 40, ping: 40 }, t + 10 * MIN);
    assert.equal(alerts('low'), 0, 'not yet');
    trackSmart(id, { online: true, players: 2, maxPlayers: 40, ping: 40 }, t + 21 * MIN);
    assert.equal(alerts('low'), 1);
    trackSmart(id, { online: true, players: 2, maxPlayers: 40, ping: 40 }, t + 40 * MIN);
    assert.equal(alerts('low'), 1, 'the cooldown holds');
    const embed = JSON.parse((db.prepare("SELECT payload FROM alerts WHERE kind = 'low'").get() as { payload: string }).payload).embed;
    assert.match(embed.description, /обычно в это время около 20/);
  });

  it('a normal reading resets the clock; a switched-off kind never fires', () => {
    const t = Date.now() + 10 * 3600_000;
    trackSmart(id, { online: true, players: 39, maxPlayers: 40, ping: 40 }, t);
    trackSmart(id, { online: true, players: 20, maxPlayers: 40, ping: 40 }, t + 10 * MIN);
    trackSmart(id, { online: true, players: 39, maxPlayers: 40, ping: 40 }, t + 20 * MIN);
    assert.equal(alerts('full'), 0, 'the clock started again at +20 min');
    trackSmart(id, { online: true, players: 39, maxPlayers: 40, ping: 40 }, t + 36 * MIN);
    assert.equal(alerts('full'), 1);
    trackSmart(id, { online: true, players: 20, maxPlayers: 40, ping: 900 }, t + 60 * MIN);
    trackSmart(id, { online: true, players: 20, maxPlayers: 40, ping: 900 }, t + 120 * MIN);
    assert.equal(alerts('ping'), 0, 'ping alerts are off');
  });
});

describe('weekly digest (data)', () => {
  it('counts players, hours and the change against the week before', () => {
    const id = addServer('Digest');
    const now = Date.now();
    const s = db.prepare('INSERT INTO player_sessions (server_id, name, joined_at, left_at) VALUES (?, ?, ?, ?)');
    s.run(id, 'Ann', now - 2 * DAY, now - 2 * DAY + 2 * 3600_000);
    s.run(id, 'Bob', now - 3 * DAY, now - 3 * DAY + 3600_000);
    s.run(id, 'Ann', now - 9 * DAY, now - 9 * DAY + 3600_000);
    const d = buildDigest(now);
    const mine = d.servers.find((x) => x.id === id)!;
    assert.equal(mine.players, 2);
    assert.equal(mine.prevPlayers, 1);
    assert.equal(mine.hours, 3);
    assert.equal(d.days.length, 7);
    assert.ok(d.top.some((p) => p.name === 'Ann' && p.hours === 2));
  });

  it('is due only on the chosen weekday and hour, once a week', () => {
    setSetting('timezone', 'UTC');
    setSetting('digest_enabled', '1');
    const monday10 = Date.UTC(2026, 9, 12, 10, 5);
    setSetting('digest_weekday', '0');
    setSetting('digest_hour', '10');
    setSetting('digest_last_sent', '0');
    assert.equal(digestDue(monday10), true);
    assert.equal(digestDue(monday10 + 3600_000), false, 'another hour');
    assert.equal(digestDue(monday10 + DAY), false, 'another day');
    setSetting('digest_last_sent', String(monday10 - 5 * MIN));
    assert.equal(digestDue(monday10), false, 'already sent this week');
  });
});

describe('api: status page and digest', () => {
  let api: Api;
  let token = '';
  let id = 0;
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
    const d = new Database(api.dbPath);
    const now = Date.now();
    id = Number(d.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('Down', 'minecraft', '127.0.0.1', 25565, ?)").run(now).lastInsertRowid);
    const h = d.prepare('INSERT INTO history (server_id, ts, online, players, ping) VALUES (?, ?, ?, ?, ?)');
    h.run(id, now - 50 * MIN, 1, 7, 40);
    h.run(id, now - 45 * MIN, 0, 0, null);
    h.run(id, now - 20 * MIN, 1, 6, 42);
    d.close();
  });
  after(async () => { await api.stop(); });

  it('status: incidents, downtime per day and response time', async () => {
    const r = await api.call('GET', '/api/status');
    assert.equal(r.status, 200);
    const inc = r.body.incidents.find((i: { serverId: number }) => i.serverId === id);
    assert.equal(inc.minutes, 25);
    assert.equal(inc.playersBefore, 7);
    assert.equal(inc.serverName, 'Down');
    const sv = r.body.servers.find((s: { id: number }) => s.id === id);
    assert.equal(sv.days.reduce((n: number, x: { down: number }) => n + x.down, 0), 25);
    assert.equal(sv.latency.length, 24);
    assert.ok(sv.latency.filter((v: number | null) => v != null).length >= 1);
  });

  it('digest: settings need a channel; the picture is served only at its signed address', async () => {
    const g = await api.call('GET', '/api/digest', { token });
    assert.equal(g.status, 200);
    assert.ok(g.body.preview.totals);
    assert.equal((await api.call('PUT', '/api/digest', { token, body: { enabled: true } })).status, 400);
    assert.equal((await api.call('POST', '/api/digest/send', { token })).status, 400);
    const png = await fetch(`${api.base}/api/digest/preview.png`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${api.base}/api/digest/123-0123456789abcdef0123.png`)).status, 404);
    assert.equal((await fetch(`${api.base}/api/digest/preview.png`)).status, 401);
  });
});
