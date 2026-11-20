/** The state of a game server from the plugin (header X-CoreGSM-Stats): parsing, storing once per time, the points for the charts. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-metrics-'));
process.env.JWT_SECRET ||= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ||= 'i'.repeat(48);
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.NODE_ENV = 'test';
const { db } = await import('../src/db.ts');
const { parseStats, saveStats, metricsOf } = await import('../src/gamenews/gameNewsMetrics.ts');

const NOW = 1_800_000_000_000;
const header = (t: number, extra = '') => `t=${Math.floor(t / 1000)};fps=29.8;min=24.1;worst=1200;freezes=2;mem=9810;heap=4100;players=14${extra}`;
const addServer = (): number =>
  Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('s', 'vrising', '127.0.0.1', 9876, ?)").run(NOW).lastInsertRowid);

describe('parseStats', () => {
  it('reads every figure', () => {
    assert.deepEqual(parseStats(header(NOW)), { t: NOW / 1000, fps: 29.8, min: 24.1, worst: 1200, freezes: 2, mem: 9810, heap: 4100, players: 14 });
  });
  it('refuses a header that is not complete or has a value out of range', () => {
    assert.equal(parseStats(''), null);
    assert.equal(parseStats('fps=30'), null);
    assert.equal(parseStats(header(NOW).replace('fps=29.8', 'fps=abc')), null);
    assert.equal(parseStats(header(NOW).replace('fps=29.8', 'fps=-1')), null);
    assert.equal(parseStats(header(NOW) + 'x'.repeat(400)), null);
  });
});

describe('saveStats', () => {
  it('keeps a point once and only a newer one after it', () => {
    const id = addServer();
    assert.equal(saveStats(id, header(NOW - 60_000), NOW), true);
    assert.equal(saveStats(id, header(NOW - 60_000), NOW), false, 'the same moment again (the next poll sends the same line)');
    assert.equal(saveStats(id, header(NOW - 120_000), NOW), false, 'an older one');
    assert.equal(saveStats(id, header(NOW - 30_000), NOW), true);
    assert.equal(metricsOf(id, 1, NOW).length, 2);
  });
  it('does not believe a clock that is far off', () => {
    const id = addServer();
    assert.equal(saveStats(id, header(NOW + 3_600_000), NOW), false);
    assert.equal(saveStats(id, header(NOW - 5 * 3_600_000), NOW), false);
    assert.equal(metricsOf(id, 24, NOW).length, 0);
  });
  it('gives the points of the asked period with the names the panel draws', () => {
    const id = addServer();
    saveStats(id, header(NOW - 30 * 60_000), NOW);
    const [p] = metricsOf(id, 1, NOW);
    assert.deepEqual(p, { ts: NOW - 30 * 60_000, fps: 29.8, minFps: 24.1, worstMs: 1200, freezes: 2, memMb: 9810, heapMb: 4100, players: 14 });
    assert.equal(metricsOf(id, 0.1, NOW).length, 0);
  });
  it('forgets the points older than two weeks', () => {
    const id = addServer();
    db.prepare('INSERT INTO server_metrics (server_id, ts, fps, min_fps, worst_ms, freezes, mem_mb, heap_mb, players) VALUES (?, ?, 30, 30, 0, 0, 1, 1, 0)').run(id, NOW - 15 * 86_400_000);
    saveStats(id, header(NOW - 1000), NOW);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM server_metrics WHERE server_id = ?').pluck().get(id), 1);
  });
});
