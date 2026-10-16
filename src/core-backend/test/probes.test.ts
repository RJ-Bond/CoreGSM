/** Probes: tokens, the target list, reports, the per-server view, and the real agent program in a round trip. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('api: probes', () => {
  let api: Api;
  let token = '';
  let probe = '';
  let probeId = 0;
  let srv = 0;
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
    const db = new Database(api.dbPath);
    srv = Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('A', 'minecraft', '127.0.0.1', 1, ?)").run(Date.now()).lastInsertRowid);
    db.prepare('INSERT INTO status (server_id, online, players, max_players, ping, updated_at) VALUES (?, 0, 0, 0, NULL, ?)').run(srv, Date.now());
    db.close();
  });
  after(async () => { await api.stop(); });

  const H = () => ({ 'x-probe-token': probe });

  it('a new probe gets a token once and ready-made commands', async () => {
    const r = await api.call('POST', '/api/probes', { token, body: { name: 'Франкфурт' } });
    assert.equal(r.status, 200);
    probe = r.body.token;
    probeId = r.body.id;
    assert.match(probe, /^cgp_/);
    assert.match(r.body.commands.docker, /docker run .*PROBE_TOKEN=cgp_/);
    const list = (await api.call('GET', '/api/probes', { token })).body;
    assert.equal(list[0].name, 'Франкфурт');
    assert.equal(list[0].alive, false);
    assert.equal(JSON.stringify(list).includes(probe), false);
  });

  it('the probe reads its targets and reports; the server page shows it next to the panel', async () => {
    assert.equal((await api.call('GET', '/api/probe/targets')).status, 401);
    const t = await api.call('GET', '/api/probe/targets', { headers: H() });
    assert.deepEqual(t.body, [{ id: srv, game: 'minecraft', host: '127.0.0.1', port: 1, queryPort: null }]);
    const r = await api.call('POST', '/api/probe/results', { headers: H(), body: [{ serverId: srv, online: true, ping: 42, players: 7 }, { serverId: 9999, online: true, ping: 1, players: 0 }] });
    assert.equal(r.status, 200);
    const v = (await api.call('GET', `/api/servers/${srv}/probes`)).body;
    assert.equal(v.panel.online, false);
    assert.deepEqual(v.probes.map((p: { name: string; online: boolean; ping: number; uptime: number }) => [p.name, p.online, p.ping, p.uptime]), [['Франкфурт', true, 42, 100]]);
    assert.equal((await api.call('GET', '/api/probes', { token })).body[0].alive, true);
  });

  it('a new token replaces the old one', async () => {
    const old = probe;
    probe = (await api.call('POST', `/api/probes/${probeId}/token`, { token })).body.token;
    assert.equal((await api.call('GET', '/api/probe/targets', { headers: { 'x-probe-token': old } })).status, 401);
    assert.equal((await api.call('GET', '/api/probe/targets', { headers: H() })).status, 200);
  });

  it('the real agent program: queries the servers and reports a round', async () => {
    const res = await fetch(`${api.base}/api/probe/agent.mjs`);
    assert.match(res.headers.get('content-type') ?? '', /javascript/);
    // placed inside the package so `gamedig` resolves from its node_modules
    const file = path.join(process.cwd(), 'test', `.probe-${process.pid}.mjs`);
    fs.writeFileSync(file, await res.text());
    const before = (await api.call('GET', `/api/servers/${srv}/probes`)).body.probes[0].updatedAt;
    const child = spawn(process.execPath, [file], { env: { ...process.env, PANEL_URL: api.base, PROBE_TOKEN: probe }, stdio: 'pipe' });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    try {
      const until = Date.now() + 30_000;
      let p;
      do {
        await new Promise((r) => setTimeout(r, 500));
        p = (await api.call('GET', `/api/servers/${srv}/probes`)).body.probes[0];
      } while (p.updatedAt === before && Date.now() < until);
      assert.notEqual(p.updatedAt, before, out);
      assert.equal(p.online, false); // nothing listens on port 1
      assert.match(out, /checked 1 servers, 0 online/);
    } finally {
      child.kill();
      fs.rmSync(file, { force: true });
    }
  });

  it('removing a probe removes its reports', async () => {
    await api.call('DELETE', `/api/probes/${probeId}`, { token });
    assert.deepEqual((await api.call('GET', `/api/servers/${srv}/probes`)).body.probes, []);
    assert.equal((await api.call('GET', '/api/probes')).status, 401);
  });
});
