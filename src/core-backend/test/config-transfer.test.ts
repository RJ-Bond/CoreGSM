/** The settings file: what goes out (no secrets), a dry run, an import into another panel, a repeat that changes nothing. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('api: settings export and import', () => {
  let a: Api;
  let b: Api;
  let ta = '';
  let tb = '';
  let file: Record<string, unknown> = {};
  before(async () => {
    [a, b] = await Promise.all([startBackend(), startBackend()]);
    [ta, tb] = await Promise.all([setupAdmin(a), setupAdmin(b)]);
    const db = new Database(a.dbPath);
    const s1 = Number(db.prepare("INSERT INTO servers (name, game, host, port, display_address, created_at) VALUES ('Alpha', 'minecraft', 'mc.example.com', 25565, 'play.example.com', ?)").run(Date.now()).lastInsertRowid);
    const s2 = Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('Beta', 'rust', '10.0.0.2', 28015, ?)").run(Date.now()).lastInsertRowid);
    db.prepare("INSERT INTO bindings (server_id, channel_id, interval_sec, enabled, style, extra_ids) VALUES (?, '123456789012345678', 120, 1, 'card', ?)").run(s1, JSON.stringify([s2]));
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('alerts_mention', 'here'), ('timezone', 'Asia/Novosibirsk'), ('brand_name', 'Blood Moon')").run();
    db.close();
    await a.call('PUT', `/api/servers/${s2}/restart`, { token: ta, body: { enabled: true, days: 1, atMin: 360, durationMin: 10, warnMin: 5, channelId: '', command: 'quit', say: 'say {text}' } });
    const saved = await a.call('PUT', '/api/settings', { token: ta, body: { discordToken: ['t'.repeat(24), 'x'.repeat(6), 'k'.repeat(27)].join('.') } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
  });
  after(async () => { await Promise.all([a.stop(), b.stop()]); });

  it('the export holds the setup and no secret', async () => {
    const r = await a.call('GET', '/api/config/export', { token: ta });
    assert.equal(r.status, 200);
    file = r.body;
    assert.equal(file.app, 'coregsm');
    assert.equal((file.servers as unknown[]).length, 2);
    assert.deepEqual((file.bindings as { server: number; extra: number[] }[])[0].extra, [1]);
    assert.equal((file.restarts as { command: string }[])[0].command, 'quit');
    assert.equal((file.settings as Record<string, string>).timezone, 'Asia/Novosibirsk');
    const text = JSON.stringify(file);
    assert.equal(/discord_token|kkkkkkkk|jwt|password/i.test(text), false);
    assert.equal((await a.call('GET', '/api/config/export')).status, 401);
  });

  it('a dry run counts and changes nothing; the import creates; a repeat only updates', async () => {
    let r = await b.call('POST', '/api/config/import?dry=1', { token: tb, body: file });
    assert.equal(r.body.dry, true);
    assert.equal(r.body.serversAdded, 2);
    assert.equal(r.body.bindings, 1);
    assert.ok(r.body.settings >= 3);
    assert.equal((await b.call('GET', '/api/servers', { token: tb })).body.length, 0);
    r = await b.call('POST', '/api/config/import', { token: tb, body: file });
    assert.equal(r.body.serversAdded, 2);
    const servers = (await b.call('GET', '/api/servers', { token: tb })).body as { id: number; name: string }[];
    assert.deepEqual(servers.map((s) => s.name).sort(), ['Alpha', 'Beta']);
    const beta = servers.find((s) => s.name === 'Beta')!;
    assert.equal((await b.call('GET', `/api/servers/${beta.id}/restart`, { token: tb })).body.command, 'quit');
    r = await b.call('POST', '/api/config/import', { token: tb, body: file });
    assert.deepEqual([r.body.serversAdded, r.body.serversUpdated, r.body.bindings, r.body.settings], [0, 2, 0, 0]);
  });

  it('a file of something else is refused with a clear message', async () => {
    const r = await b.call('POST', '/api/config/import', { token: tb, body: { hello: 'world' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'config_bad_file');
  });
});
