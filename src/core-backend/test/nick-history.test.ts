/** A player who changed the in-game nickname: the old name keeps working as a page and says whom it belongs to now. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('nick history', () => {
  let api: Api;
  let token = '';
  before(async () => {
    api = await startBackend();
    const admin = await setupAdmin(api);
    token = ((await api.call('POST', '/api/auth/register', { body: { username: 'renamer', password: 'Passw0rd!long', acceptRules: true } })).body as { token: string }).token;
    const sid = ((await api.call('POST', '/api/servers', { token: admin, body: { name: 'Nick test', game: 'vrising', host: '127.0.0.1', port: 25597 } })).body as { id: number }).id;
    const { default: Database } = await import('better-sqlite3');
    const d = new Database(api.dbPath);
    for (const n of ['OldName', 'NewName']) d.prepare('INSERT INTO player_sessions (server_id, name, joined_at, left_at) VALUES (?, ?, ?, ?)').run(sid, n, Date.now() - 7200_000, Date.now() - 3600_000);
    d.close();
  });
  after(async () => { await api.stop(); });

  it('names the other nicknames of the same person on the page of each of them', async () => {
    assert.equal((await api.call('PUT', '/api/me/player', { token, body: { gameNick: 'OldName', publicProfile: true } })).status, 200);
    assert.equal((await api.call('PUT', '/api/me/player', { token, body: { gameNick: 'NewName' } })).status, 200);
    const old = (await api.call('GET', '/api/players/OldName')).body as { aliases: string[] };
    assert.deepEqual(old.aliases, ['NewName'], 'the old page points at the current nickname');
    const cur = (await api.call('GET', '/api/players/NewName')).body as { aliases: string[] };
    assert.deepEqual(cur.aliases, ['OldName'], 'the current page remembers the old one');
    const pub = (await api.call('GET', '/api/u/renamer')).body as { formerNicks: string[] };
    assert.deepEqual(pub.formerNicks, ['OldName']);
  });

  it('tells nothing when the person keeps the statistics private', async () => {
    assert.equal((await api.call('PUT', '/api/me/player', { token, body: { privacy: { stats: false } } })).status, 200);
    assert.deepEqual(((await api.call('GET', '/api/players/OldName')).body as { aliases: string[] }).aliases, []);
  });
});
