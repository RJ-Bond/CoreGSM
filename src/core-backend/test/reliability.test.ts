/**
 * Reliability core: confirmed failures, poll pool, maintenance windows, versioned migrations,
 * backup/restore round trip, health history.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { clampConcurrency, clampThreshold, decideStatus, runPool } from '../src/pollLogic.ts';
import { ADMIN, setupAdmin, startBackend, type Api } from './harness.ts';

// ---------------------------------------------------------------- pure logic
describe('failure confirmation (decideStatus)', () => {
  const base = { prevOnline: true, prevFailures: 0, threshold: 2 };

  it('a successful poll resets everything', () => {
    const d = decideStatus({ ...base, prevFailures: 1, polledOnline: true });
    assert.deepEqual(d, { online: true, confirmed: true, failures: 0, becameOffline: false });
  });

  it('keeps the last good state until K polls in a row failed', () => {
    const first = decideStatus({ ...base, polledOnline: false });
    assert.deepEqual(first, { online: true, confirmed: false, failures: 1, becameOffline: false });
    const second = decideStatus({ ...base, prevFailures: 1, polledOnline: false });
    assert.deepEqual(second, { online: false, confirmed: true, failures: 2, becameOffline: true });
  });

  it('threshold 1 means no waiting, 5 means four held polls', () => {
    assert.equal(decideStatus({ ...base, threshold: 1, polledOnline: false }).online, false);
    let failures = 0;
    for (let i = 1; i <= 4; i++) {
      const d = decideStatus({ prevOnline: true, prevFailures: failures, polledOnline: false, threshold: 5 });
      assert.equal(d.online, true, `poll ${i}`);
      failures = d.failures;
    }
    assert.equal(decideStatus({ prevOnline: true, prevFailures: 4, polledOnline: false, threshold: 5 }).online, false);
  });

  it('a new server and an already offline one are not held back', () => {
    assert.equal(decideStatus({ prevOnline: null, prevFailures: 0, polledOnline: false, threshold: 5 }).confirmed, true);
    const d = decideStatus({ prevOnline: false, prevFailures: 7, polledOnline: false, threshold: 5 });
    assert.deepEqual(d, { online: false, confirmed: true, failures: 8, becameOffline: false });
  });

  it('settings are clamped', () => {
    assert.equal(clampThreshold(undefined), 2);
    assert.equal(clampThreshold('0'), 1);
    assert.equal(clampThreshold(99), 5);
    assert.equal(clampConcurrency(null), 8);
    assert.equal(clampConcurrency('0'), 1);
    assert.equal(clampConcurrency(500), 32);
  });
});

describe('poll pool', () => {
  it('never runs more than `limit` workers and survives failures', async () => {
    let active = 0;
    let peak = 0;
    let done = 0;
    await runPool(Array.from({ length: 20 }, (_, i) => i), 3, async (i) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      done++;
      if (i % 4 === 0) throw new Error('boom');
    });
    assert.equal(done, 20);
    assert.ok(peak <= 3 && peak >= 2, `peak ${peak}`);
  });
});

// ---------------------------------------------------------------- in-process: database, poll, maintenance
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-rel-'));
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.NODE_ENV = 'test';
const { db, setSetting } = await import('../src/db.ts');
const { applyPollResult } = await import('../src/gsm.ts');
const { trackAlerts } = await import('../src/alerts.ts');
const M = await import('../src/maintenance.ts');
const { appliedVersions, LATEST_VERSION, runMigrations, MIGRATIONS } = await import('../src/migrations.ts');
const health = await import('../src/health.ts');
type ServerRow = import('../src/db.ts').ServerRow;
type QueryResult = import('../src/gsm.ts').QueryResult;

const UP: QueryResult = { online: true, name: 'S', players: 3, maxPlayers: 10, map: 'm', version: null, ping: 20, playerNames: ['a'], error: null };
const DOWN: QueryResult = { online: false, name: null, players: 0, maxPlayers: 0, map: null, version: null, ping: null, playerNames: [], error: 'no answer' };

let seq = 0;
function addServer(): ServerRow {
  const info = db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES (?, 'minecraft', '127.0.0.1', 25565, ?)").run(`srv${++seq}`, Date.now());
  return db.prepare('SELECT * FROM servers WHERE id = ?').get(info.lastInsertRowid) as ServerRow;
}
const status = (id: number) => db.prepare('SELECT online, consecutive_failures AS f FROM status WHERE server_id = ?').get(id) as { online: number; f: number };
const uptime = (id: number) =>
  (db.prepare('SELECT AVG(CASE WHEN unconfirmed = 0 AND maint = 0 THEN online END) * 100 AS u FROM history WHERE server_id = ?').get(id) as { u: number | null }).u;
const addWindow = (serverId: number | null, startOff: number, endOff: number, repeat = 'none') => {
  const now = Date.now();
  const r = db
    .prepare('INSERT INTO maintenance_windows (server_id, name, start_ts, end_ts, repeat, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(serverId, 'Плановые работы', now + startOff, now + endOff, repeat, 'test', now);
  M.resetMaintenanceCache();
  return Number(r.lastInsertRowid);
};
const dropWindows = () => {
  db.prepare('DELETE FROM maintenance_windows').run();
  M.resetMaintenanceCache();
};

describe('confirmed failures in the poller', () => {
  it('holds the state for the first failed poll and flips on the second', () => {
    const s = addServer();
    const t = Date.now();
    applyPollResult(s, UP, t, { debounce: true });
    assert.deepEqual(status(s.id), { online: 1, f: 0 });

    const o1 = applyPollResult(s, DOWN, t + 1000, { debounce: true });
    assert.equal(o1.confirmed, false);
    assert.deepEqual(status(s.id), { online: 1, f: 1 });
    // the unconfirmed sample must not count as downtime
    assert.equal(uptime(s.id), 100);
    assert.equal((db.prepare('SELECT COUNT(*) AS c FROM history WHERE server_id = ? AND unconfirmed = 1').get(s.id) as { c: number }).c, 1);

    const o2 = applyPollResult(s, DOWN, t + 2000, { debounce: true });
    assert.equal(o2.confirmed, true);
    assert.deepEqual(status(s.id), { online: 0, f: 2 });
    // the outage started with the first failure: both failed samples are offline now
    assert.equal((db.prepare('SELECT COUNT(*) AS c FROM history WHERE server_id = ? AND online = 0').get(s.id) as { c: number }).c, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM history WHERE server_id = ? AND unconfirmed = 1').pluck().get(s.id), 0);
    const day = db.prepare('SELECT up, total FROM uptime_daily WHERE server_id = ?').get(s.id) as { up: number; total: number };
    assert.deepEqual(day, { up: 1, total: 3 });

    applyPollResult(s, UP, t + 3000, { debounce: true });
    assert.deepEqual(status(s.id), { online: 1, f: 0 });
  });

  it('a single blip between good polls never shows the server offline', () => {
    const s = addServer();
    const t = Date.now();
    applyPollResult(s, UP, t, { debounce: true });
    applyPollResult(s, DOWN, t + 1, { debounce: true });
    applyPollResult(s, UP, t + 2, { debounce: true });
    applyPollResult(s, DOWN, t + 3, { debounce: true });
    applyPollResult(s, UP, t + 4, { debounce: true });
    assert.deepEqual(status(s.id), { online: 1, f: 0 });
    assert.equal(uptime(s.id), 100);
  });

  it('a manual refresh (no debounce) is believed at once; poll_fail_threshold is honoured', () => {
    const s = addServer();
    const t = Date.now();
    applyPollResult(s, UP, t);
    applyPollResult(s, DOWN, t + 1);
    assert.equal(status(s.id).online, 0);

    setSetting('poll_fail_threshold', '3');
    const s2 = addServer();
    applyPollResult(s2, UP, t, { debounce: true });
    applyPollResult(s2, DOWN, t + 1, { debounce: true });
    applyPollResult(s2, DOWN, t + 2, { debounce: true });
    assert.equal(status(s2.id).online, 1);
    applyPollResult(s2, DOWN, t + 3, { debounce: true });
    assert.equal(status(s2.id).online, 0);
    setSetting('poll_fail_threshold', null);
  });
});

describe('maintenance windows', () => {
  it('window maths: one-off, daily, weekly', () => {
    const w = { start_ts: 1_000_000, end_ts: 1_000_000 + 3_600_000, repeat: 'none' as const };
    assert.ok(M.occurrenceAt(w, 1_000_000));
    assert.equal(M.occurrenceAt(w, 1_000_000 + 3_600_000), null);
    assert.equal(M.occurrenceAt(w, 999_999), null);
    const daily = { ...w, repeat: 'daily' as const };
    const third = M.occurrenceAt(daily, 1_000_000 + 2 * 86_400_000 + 60_000);
    assert.equal(third?.start, 1_000_000 + 2 * 86_400_000);
    assert.equal(M.occurrenceAt(daily, 1_000_000 + 2 * 86_400_000 + 2 * 3_600_000), null);
    const weekly = { ...w, repeat: 'weekly' as const };
    assert.equal(M.occurrenceAt(weekly, 1_000_000 + 86_400_000 + 60_000), null);
    assert.ok(M.occurrenceAt(weekly, 1_000_000 + 7 * 86_400_000 + 60_000));
    assert.equal(M.nextOccurrence(weekly, 1_000_000 + 4 * 3_600_000)?.start, 1_000_000 + 7 * 86_400_000);
  });

  it('suppresses down alerts; an outage still going on after the window alerts normally', () => {
    setSetting('alerts_enabled', '1');
    setSetting('alerts_channel', '123456789012345678');
    const s = addServer();
    const downAlerts = () => (db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE kind = 'down' AND server_name = ?").get(`srv${seq}`) as { c: number }).c;
    const past = Date.now() - 10 * 60_000;

    addWindow(s.id, -60_000, 30 * 60_000);
    assert.ok(M.maintenanceFor(s.id));
    db.prepare('INSERT OR REPLACE INTO alert_state (server_id, down_since, alerted) VALUES (?, ?, 0)').run(s.id, past);
    trackAlerts(s.id, false, 'no answer');
    assert.equal(downAlerts(), 0);
    // the outage is forgotten, it will count from the end of the window
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM alert_state WHERE server_id = ?').pluck().get(s.id), 0);

    dropWindows();
    assert.equal(M.maintenanceFor(s.id), null);
    trackAlerts(s.id, false, 'no answer'); // outage continues: state starts now
    assert.equal(downAlerts(), 0);
    db.prepare('UPDATE alert_state SET down_since = ? WHERE server_id = ?').run(past, s.id);
    trackAlerts(s.id, false, 'no answer');
    assert.equal(downAlerts(), 1);
    setSetting('alerts_enabled', null);
  });

  it('a window for another server does not mute this one; an all-servers window does', () => {
    const a = addServer();
    const b = addServer();
    addWindow(a.id, -1000, 60_000);
    assert.ok(M.maintenanceFor(a.id));
    assert.equal(M.maintenanceFor(b.id), null);
    addWindow(null, -1000, 120_000);
    const m = M.maintenanceFor(b.id);
    assert.ok(m && m.name === 'Плановые работы' && m.until > Date.now());
    dropWindows();
  });

  it('downtime inside a window does not reduce uptime', () => {
    const s = addServer();
    const t = Date.now();
    applyPollResult(s, UP, t - 5000, { debounce: true });
    applyPollResult(s, UP, t - 4000, { debounce: true });
    addWindow(s.id, -3000, 60_000);
    applyPollResult(s, DOWN, t - 2000, { debounce: true });
    applyPollResult(s, DOWN, t - 1000, { debounce: true });
    applyPollResult(s, DOWN, t, { debounce: true });
    assert.equal(status(s.id).online, 0);
    assert.equal(uptime(s.id), 100);
    const day = db.prepare('SELECT up, total FROM uptime_daily WHERE server_id = ?').get(s.id) as { up: number; total: number };
    assert.deepEqual(day, { up: 2, total: 2 });
    // the same outage outside a window does hurt
    dropWindows();
    const s2 = addServer();
    applyPollResult(s2, UP, t, { debounce: true });
    applyPollResult(s2, DOWN, t + 1, { debounce: true });
    applyPollResult(s2, DOWN, t + 2, { debounce: true });
    assert.ok((uptime(s2.id) ?? 100) < 100);
  });
});

describe('versioned migrations', () => {
  it('a fresh database has every migration recorded and needed no copy', () => {
    const v = appliedVersions(db);
    assert.deepEqual(v, MIGRATIONS.map((m) => m.version));
    assert.equal(v[v.length - 1], LATEST_VERSION);
    assert.ok(!fs.existsSync(path.join(tmp, 'backups')) || fs.readdirSync(path.join(tmp, 'backups')).every((f) => !f.startsWith('pre-migrate-')));
  });

  const oldSchema = (file: string) => {
    const o = new Database(file);
    o.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE servers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, game TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, query_port INTEGER, created_at INTEGER NOT NULL);
      CREATE TABLE status (server_id INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE, online INTEGER NOT NULL DEFAULT 0, name TEXT, players INTEGER NOT NULL DEFAULT 0,
        max_players INTEGER NOT NULL DEFAULT 0, map TEXT, version TEXT, ping INTEGER, player_names TEXT NOT NULL DEFAULT '[]', error TEXT, updated_at INTEGER NOT NULL);
      CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE, ts INTEGER NOT NULL, online INTEGER NOT NULL, players INTEGER NOT NULL);
      INSERT INTO users (username, password_hash) VALUES ('old', 'x');
      INSERT INTO servers (name, game, host, port, created_at) VALUES ('Old', 'minecraft', '127.0.0.1', 25565, 1);
      INSERT INTO status (server_id, online, updated_at) VALUES (1, 1, 1);
      INSERT INTO history (server_id, ts, online, players) VALUES (1, 1, 1, 5);
    `);
    return o;
  };
  const cols = (d: InstanceType<typeof Database>, t: string) => (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

  it('an old database upgrades: copy first, data kept, rerun is a no-op, only 5 copies kept', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'old-'));
    const file = path.join(dir, 'coregsm.db');
    const o = oldSchema(file);
    assert.ok(!cols(o, 'status').includes('consecutive_failures'));

    const logs: string[] = [];
    const r = runMigrations(o, { dataDir: dir, existing: true, log: (m) => logs.push(m) });
    assert.deepEqual(r.applied, MIGRATIONS.map((m) => m.version));
    assert.ok(r.backup && fs.existsSync(r.backup));
    assert.match(path.basename(r.backup!), new RegExp(`^pre-migrate-v${LATEST_VERSION}-\\d+\\.db$`));

    // the copy is the database as it was
    const copy = new Database(r.backup!, { readonly: true });
    assert.ok(!cols(copy, 'status').includes('consecutive_failures'));
    assert.equal(copy.prepare('SELECT COUNT(*) AS c FROM history').pluck().get(), 1);
    copy.close();

    assert.ok(cols(o, 'status').includes('consecutive_failures'));
    assert.deepEqual(cols(o, 'history').filter((c) => ['unconfirmed', 'maint'].includes(c)).sort(), ['maint', 'unconfirmed']);
    for (const t of ['maintenance_windows', 'health_samples', 'schema_migrations']) assert.ok(cols(o, t).length > 0, t);
    assert.equal(o.prepare('SELECT players FROM history').pluck().get(), 5);

    const again = runMigrations(o, { dataDir: dir, existing: true, log: () => undefined });
    assert.deepEqual(again, { applied: [], backup: null });

    // retention: a pending migration after many runs keeps the newest 5 copies
    const bdir = path.join(dir, 'backups');
    for (let i = 1; i <= 8; i++) fs.writeFileSync(path.join(bdir, `pre-migrate-v1-${1000 + i}.db`), 'x');
    const extra = { version: LATEST_VERSION + 1, name: 'test-extra', up: (d: InstanceType<typeof Database>) => d.exec('CREATE TABLE IF NOT EXISTS t_extra (a INTEGER)') };
    const r3 = runMigrations(o, { dataDir: dir, existing: true, list: [...MIGRATIONS, extra], log: () => undefined });
    assert.deepEqual(r3.applied, [LATEST_VERSION + 1]);
    assert.equal(fs.readdirSync(bdir).filter((f) => f.startsWith('pre-migrate-')).length, 5);
    o.close();
  });

  it('a failing migration rolls back, names itself and the copy', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'fail-'));
    const o = oldSchema(path.join(dir, 'coregsm.db'));
    const bad = { version: 1, name: 'baseline', up: () => undefined };
    const broken = {
      version: 2,
      name: 'broken',
      up: (d: InstanceType<typeof Database>) => {
        d.exec('CREATE TABLE half_done (a INTEGER)');
        d.exec('THIS IS NOT SQL');
      },
    };
    assert.throws(() => runMigrations(o, { dataDir: dir, existing: true, list: [bad, broken], log: () => undefined }), /v2 «broken»/);
    assert.equal(o.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'half_done'").pluck().get(), 0);
    assert.deepEqual(o.prepare('SELECT version FROM schema_migrations').pluck().all(), [1]);
    o.close();
  });
});

describe('health flags (pure)', () => {
  const S = (o: Partial<import('../src/health.ts').Sample>): import('../src/health.ts').Sample => ({
    ts: 0, dbBytes: 1_000_000, rssMb: 100, pollMs: 500, pollFailures: 0, botState: 'online', queueLen: 0, diskFree: 50 * 1073741824, ...o,
  });
  const now = 10 * 86_400_000;

  it('is quiet when all is well', () => {
    assert.deepEqual(health.computeFlags([S({ ts: now - 600_000 })], S({ ts: now }), 30_000, now), []);
  });

  it('reports a bot that has been offline since the first bad sample', () => {
    const samples = [S({ ts: now - 40 * 60_000 }), S({ ts: now - 30 * 60_000, botState: 'offline' }), S({ ts: now - 20 * 60_000, botState: 'offline' })];
    const f = health.computeFlags(samples, S({ ts: now, botState: 'offline' }), 30_000, now);
    assert.equal(f.length, 1);
    assert.equal(f[0].kind, 'bot_offline');
    assert.equal(f[0].since, now - 30 * 60_000);
  });

  it('reports a slow poll, low disk and a growing database', () => {
    const old = S({ ts: now - 2 * 86_400_000, dbBytes: 40 * 1048576 });
    const cur = S({ ts: now, pollMs: 28_000, diskFree: 200 * 1048576, dbBytes: 140 * 1048576 });
    const kinds = health.computeFlags([old], cur, 30_000, now).map((f) => f.kind).sort();
    assert.deepEqual(kinds, ['db_growing', 'disk_low', 'poll_slow']);
  });
});

after(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ---------------------------------------------------------------- real backend over HTTP
describe('maintenance and health over the API', () => {
  let api: Api;
  let token = '';
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
  });
  after(async () => {
    await api.stop();
  });

  it('validates windows and exposes them on servers', async () => {
    const srv = await api.call('POST', '/api/servers', { token, body: { name: 'M', game: 'minecraft', host: '127.0.0.1', port: 25570 } });
    assert.ok([200, 201].includes(srv.status), JSON.stringify(srv.body));
    const id = srv.body.id as number;
    assert.equal(srv.body.maintenance, null);

    const now = Date.now();
    const post = (b: object) => api.call('POST', '/api/maintenance', { token, body: b });
    assert.equal((await post({ name: 'x', startTs: now, endTs: now })).status, 400);
    assert.equal((await post({ name: 'x', startTs: now, endTs: now + 8 * 86_400_000 })).status, 400);
    assert.equal((await post({ name: 'x', startTs: now, endTs: now + 3600_000, serverId: 99999 })).status, 400);
    assert.equal((await post({ name: '', startTs: now, endTs: now + 3600_000 })).status, 400);
    assert.equal((await api.call('POST', '/api/maintenance', { body: { name: 'x', startTs: now, endTs: now + 1000 } })).status, 401);

    const c = await post({ name: 'Обновление', serverId: id, startTs: now - 1000, endTs: now + 3600_000, repeat: 'none' });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(c.body.active, true);
    assert.equal(c.body.serverId, id);

    const list = await api.call('GET', `/api/servers`, { token });
    const s = (list.body as { id: number; maintenance: { name: string; until: number } | null }[]).find((x) => x.id === id)!;
    assert.equal(s.maintenance?.name, 'Обновление');
    assert.equal(s.maintenance?.until, now + 3600_000);
    const det = await api.call('GET', `/api/servers/${id}/details`, { token });
    assert.equal(det.body.server.maintenance.name, 'Обновление');
    assert.ok((det.body.events as { type: string }[]).some((e) => e.type === 'maintenance'));

    const act = await api.call('GET', '/api/maintenance/active', { token });
    assert.equal(act.status, 200);
    assert.equal(act.body.length, 1);

    const u = await api.call('PUT', `/api/maintenance/${c.body.id}`, { token, body: { name: 'Позже', serverId: id, startTs: now + 7200_000, endTs: now + 10800_000 } });
    assert.equal(u.status, 200);
    assert.equal(u.body.active, false);
    assert.equal(u.body.nextStart, now + 7200_000);
    assert.equal((await api.call('GET', '/api/maintenance/active', { token })).body.length, 0);

    assert.equal((await api.call('DELETE', `/api/maintenance/${c.body.id}`, { token })).status, 200);
    assert.equal((await api.call('DELETE', `/api/maintenance/${c.body.id}`, { token })).status, 404);
    assert.equal((await api.call('GET', '/api/maintenance', { token })).body.length, 0);
  });

  it('poll settings: defaults, update, validation', async () => {
    const g = await api.call('GET', '/api/settings/poll', { token });
    assert.equal(g.status, 200);
    assert.equal(g.body.failThreshold, 2);
    assert.equal(g.body.concurrency, 8);
    const p = await api.call('PUT', '/api/settings/poll', { token, body: { failThreshold: 3, concurrency: 4 } });
    assert.equal(p.status, 200);
    assert.deepEqual([p.body.failThreshold, p.body.concurrency], [3, 4]);
    assert.equal((await api.call('PUT', '/api/settings/poll', { token, body: { failThreshold: 9 } })).status, 400);
    assert.equal((await api.call('PUT', '/api/settings/poll', { token, body: { concurrency: 0 } })).status, 400);
  });

  it('health history and flags', async () => {
    const h = await api.call('GET', '/api/system/health-history?hours=24', { token });
    assert.equal(h.status, 200);
    assert.ok(Array.isArray(h.body.samples) && h.body.samples.length >= 1);
    assert.ok(Array.isArray(h.body.flags));
    const sample = h.body.samples[0];
    for (const k of ['ts', 'dbBytes', 'rssMb', 'pollMs', 'pollFailures', 'botState', 'queueLen']) assert.ok(k in sample, k);
    const sys = await api.call('GET', '/api/system', { token });
    assert.equal(sys.status, 200);
    assert.ok(Array.isArray(sys.body.flags));
    assert.equal((await api.call('GET', '/api/system/health-history')).status, 401);
  });
});

describe('backup, change, restore', () => {
  it('brings the data back', { timeout: 120_000 }, async () => {
    const api = await startBackend();
    let second: Api | null = null;
    try {
      const token = await setupAdmin(api);
      const now = Date.now();
      const mk = (name: string) => api.call('POST', '/api/maintenance', { token, body: { name, startTs: now + 3600_000, endTs: now + 7200_000 } });
      assert.equal((await mk('before-backup')).status, 201);

      const run = await api.call('POST', '/api/backups/run', { token });
      assert.equal(run.status, 201, JSON.stringify(run.body));
      const name = run.body.name as string;

      // data changes after the backup
      assert.equal((await mk('after-backup')).status, 201);
      const changed = await api.call('GET', '/api/maintenance', { token });
      assert.deepEqual((changed.body as { name: string }[]).map((w) => w.name).sort(), ['after-backup', 'before-backup']);

      const rs = await api.call('POST', `/api/backups/${name}/restore`, { token, body: {} });
      assert.equal(rs.status, 200, JSON.stringify(rs.body));
      assert.equal(rs.body.restarting, true);

      // the process kills itself; wait until it is gone
      for (let i = 0; i < 100; i++) {
        try {
          await fetch(`${api.base}/api/setup/status`, { signal: AbortSignal.timeout(500) });
        } catch {
          break;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      await new Promise((r) => setTimeout(r, 500));

      // the "container restart": the same data directory is opened again and the staged restore is applied
      second = await startBackend({ DB_PATH: api.dbPath });
      const login = await second.call('POST', '/api/auth/login', { body: ADMIN });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      const after = await second.call('GET', '/api/maintenance', { token: login.body.token });
      assert.deepEqual((after.body as { name: string }[]).map((w) => w.name), ['before-backup']);
    } finally {
      if (second) await second.stop();
      await api.stop();
    }
  });
});

describe('an old database starts and upgrades', () => {
  it('opens a baseline-only database through the real backend', { timeout: 120_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-old-'));
    const file = path.join(dir, 'coregsm.db');
    const o = new Database(file);
    o.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE servers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, game TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, query_port INTEGER, created_at INTEGER NOT NULL);
      CREATE TABLE status (server_id INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE, online INTEGER NOT NULL DEFAULT 0, name TEXT, players INTEGER NOT NULL DEFAULT 0,
        max_players INTEGER NOT NULL DEFAULT 0, map TEXT, version TEXT, ping INTEGER, player_names TEXT NOT NULL DEFAULT '[]', error TEXT, updated_at INTEGER NOT NULL);
      CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE, ts INTEGER NOT NULL, online INTEGER NOT NULL, players INTEGER NOT NULL);
    `);
    o.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(ADMIN.username, bcrypt.hashSync(ADMIN.password, 4));
    o.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('Old', 'minecraft', '127.0.0.1', 25565, 1)").run();
    o.prepare('INSERT INTO status (server_id, online, updated_at) VALUES (1, 1, 1)').run();
    o.prepare('INSERT INTO history (server_id, ts, online, players) VALUES (1, ?, 1, 5)').run(Date.now());
    o.close();

    const api = await startBackend({ DB_PATH: file });
    try {
      const login = await api.call('POST', '/api/auth/login', { body: ADMIN });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      const list = await api.call('GET', '/api/servers', { token: login.body.token });
      assert.equal(list.status, 200);
      assert.equal(list.body[0].name, 'Old');
      assert.equal(list.body[0].maintenance, null);

      const check = new Database(file, { readonly: true });
      const versions = check.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all();
      assert.deepEqual(versions, MIGRATIONS.map((m) => m.version));
      assert.equal(check.prepare('SELECT players FROM history').pluck().get(), 5);
      check.close();
      const copies = fs.readdirSync(path.join(dir, 'backups')).filter((f) => /^pre-migrate-v\d+-\d+\.db$/.test(f));
      assert.equal(copies.length, 1);
    } finally {
      await api.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
