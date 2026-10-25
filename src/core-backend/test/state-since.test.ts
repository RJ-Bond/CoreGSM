/** The admin list shows how long a server has been in its current state: status.state_since → stateSince. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('api: time in the current state', () => {
  let api: Api;
  let token = '';
  let id = 0;
  const since = Date.now() - 7_200_000;
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
    const db = new Database(api.dbPath);
    id = Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('S', 'minecraft', '127.0.0.1', 25565, ?)").run(Date.now()).lastInsertRowid);
    db.prepare('INSERT INTO status (server_id, online, updated_at, state_since) VALUES (?, 0, ?, ?)').run(id, Date.now(), since);
    db.close();
  });
  after(async () => { await api.stop(); });

  it('the server list carries stateSince', async () => {
    const r = await api.call('GET', '/api/servers', { token });
    assert.equal(r.status, 200);
    const s = (r.body as { id: number; stateSince: number | null }[]).find((x) => x.id === id)!;
    assert.equal(s.stateSince, since);
  });
});
