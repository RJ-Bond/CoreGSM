/** The page of one outage: the story in order, the chart points, and the address. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';
import { buildTimeline, samplePoints } from '../src/routes/incidentLogic.ts';

describe('the story of an outage', () => {
  const i = { start: 1000, end: 61_000, playersBefore: 7, planned: false };
  it('is told in order: down, what happened meanwhile, back', () => {
    const t = buildTimeline(i, [{ title: 'Ищем причину', body: '', level: 'warn', created_at: 20_000, resolved_at: 70_000 }], [{ ts: 30_000, kind: 'version', oldValue: '1', newValue: '2' }]);
    assert.deepEqual(t.map((x) => x.kind), ['down', 'note', 'change', 'up', 'noteDone']);
    assert.equal(t[3].kind === 'up' && t[3].minutes, 1);
  });
  it('has no «back» while the server is still down', () => {
    assert.deepEqual(buildTimeline({ ...i, end: null }, [], []).map((x) => x.kind), ['down']);
  });
  it('keeps the bad points when it thins the chart', () => {
    const rows = Array.from({ length: 1000 }, (_, k) => ({ ts: k, online: k === 503 ? 0 : 1, players: 5 }));
    const out = samplePoints(rows, 100);
    assert.equal(out.length, 100);
    assert.equal(out.filter((p) => !p.online).length, 1);
    assert.equal(samplePoints(rows.slice(0, 3), 100).length, 3);
  });
});

describe('api: /api/status/incidents', () => {
  let api: Api;
  let token = '';
  let sid = 0;
  const NOW = Date.now();
  const start = NOW - 3_600_000;
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
    sid = ((await api.call('POST', '/api/servers', { token, body: { name: 'Outage test', game: 'vrising', host: '127.0.0.1', port: 25598 } })).body as { id: number }).id;
    const { default: Database } = await import('better-sqlite3');
    const d = new Database(api.dbPath);
    d.prepare('DELETE FROM history WHERE server_id = ?').run(sid);
    const put = d.prepare('INSERT INTO history (server_id, ts, online, players) VALUES (?, ?, ?, ?)');
    put.run(sid, start - 60_000, 1, 9);
    put.run(sid, start, 0, 0);
    put.run(sid, start + 60_000, 0, 0);
    put.run(sid, start + 600_000, 1, 2);
    d.close();
  });
  after(async () => { await api.stop(); });

  it('gives the outage with its story and points to a guest, without the internal address', async () => {
    const r = await api.call('GET', `/api/status/incidents/${sid}/${start}`);
    assert.equal(r.status, 200);
    const b = r.body as { incident: { end: number; playersBefore: number; serverName: string }; timeline: { kind: string }[]; points: unknown[] };
    assert.equal(b.incident.end, start + 600_000);
    assert.equal(b.incident.playersBefore, 9);
    assert.equal(b.incident.serverName, 'Outage test');
    assert.deepEqual(b.timeline.map((x) => x.kind), ['down', 'up']);
    assert.equal(b.points.length, 4);
    assert.equal(JSON.stringify(b).includes('127.0.0.1'), false);
  });
  it('answers 404 for a moment without an outage and for an unknown server', async () => {
    assert.equal((await api.call('GET', `/api/status/incidents/${sid}/${start + 1}`)).status, 404);
    assert.equal((await api.call('GET', `/api/status/incidents/9999/${start}`)).status, 404);
    assert.equal((await api.call('GET', `/api/status/incidents/x/y`)).status, 404);
  });
});
