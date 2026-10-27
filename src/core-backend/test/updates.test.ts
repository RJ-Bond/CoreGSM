/** Updates tab: history of the host jobs, preflight, channel / skipped version / notices. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('api: updates', () => {
  let api: Api;
  let token = '';
  let upd = '';
  const writeJob = (j: object) => fs.writeFileSync(path.join(upd, 'status.json'), JSON.stringify(j));
  before(async () => {
    upd = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-upd-'));
    api = await startBackend({ UPDATE_DIR: upd });
    token = await setupAdmin(api);
    const db = new Database(api.dbPath);
    db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('A', 'minecraft', '127.0.0.1', 25565, ?)").run(Date.now());
    db.prepare('INSERT INTO status (server_id, online, players, max_players, updated_at) VALUES (1, 1, 4, 20, ?)').run(Date.now());
    db.close();
  });
  after(async () => { await api.stop(); fs.rmSync(upd, { recursive: true, force: true }); });

  it('needs an administrator', async () => {
    assert.equal((await api.call('GET', '/api/update/history')).status, 401);
    assert.equal((await api.call('GET', '/api/update/preflight')).status, 401);
  });

  it('counts what an update would interrupt', async () => {
    const r = await api.call('GET', '/api/update/preflight', { token });
    assert.equal(r.status, 200);
    assert.equal(r.body.players, 4);
    assert.equal(r.body.onlineServers, 1);
  });

  it('records a finished job once, newest first, and skips «already latest»', async () => {
    assert.deepEqual((await api.call('GET', '/api/update/history', { token })).body, []);
    writeJob({ state: 'done', message: 'Обновлено до версии abcdef1', time: 1000, rollback_available: true });
    let h = (await api.call('GET', '/api/update/history', { token })).body;
    assert.equal(h.length, 1);
    assert.equal(h[0].kind, 'update');
    assert.equal(h[0].state, 'done');
    await api.call('GET', '/api/update/history', { token }); // reading again does not duplicate
    writeJob({ state: 'error', message: 'Обновление не удалось, выполнен откат на abc', time: 2000 });
    assert.equal((await api.call('GET', '/api/update/history', { token })).body.length, 2);
    writeJob({ state: 'done', message: 'Уже установлена последняя версия (abc)', time: 3000 });
    h = (await api.call('GET', '/api/update/history', { token })).body;
    assert.equal(h.length, 2);
    assert.equal(h[0].time, 2000);
    assert.equal(h[0].kind, 'rollback');
  });

  it('keeps the channel, the skipped build and the notice switch', async () => {
    let r = await api.call('PUT', '/api/update/settings', { token, body: { channel: 'main', skip: 'abcdef123456', notify: false } });
    assert.equal(r.status, 200);
    assert.equal(r.body.channel, 'main');
    assert.equal(r.body.notify, false);
    assert.equal(fs.readFileSync(path.join(upd, 'channel'), 'utf8'), 'main');
    r = await api.call('PUT', '/api/update/settings', { token, body: { skip: null, notify: true } });
    assert.equal(r.body.notify, true);
    // the notices about changes without a release (the «Fresh» channel) are off until the administrator asks for them
    assert.equal(r.body.notifyMain, false);
    r = await api.call('PUT', '/api/update/settings', { token, body: { notifyMain: true } });
    assert.equal(r.body.notifyMain, true);
    r = await api.call('PUT', '/api/update/settings', { token, body: { notifyMain: false } });
    assert.equal(r.body.notifyMain, false);
    assert.equal((await api.call('PUT', '/api/update/settings', { token, body: { channel: 'nightly' } })).status, 400);
    assert.equal((await api.call('PUT', '/api/update/settings', { token, body: { skip: 'not a build' } })).status, 400);
  });
});
