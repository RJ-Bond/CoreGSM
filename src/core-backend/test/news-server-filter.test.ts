/** GET /api/news?server=<id>: only the news that name the server (its page shows the fresh one). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const channelId = '123456789012345678';

describe('news: the filter by server', () => {
  let api: Api;
  let admin = '';
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    const db = new Database(api.dbPath);
    const mk = async (text: string, statusServerIds?: number[]) => {
      const id = (await api.call('POST', '/api/news', { token: admin, body: { channelId, action: 'draft', payload: { content: text, ...(statusServerIds ? { statusServerIds } : {}) } } })).body.id as number;
      db.prepare("UPDATE news SET status = 'sent', sent_at = ?, message_id = '1' WHERE id = ?").run(Date.now() - 1000, id);
    };
    await mk('about one', [1]);
    await mk('about two', [2, 3]);
    await mk('about nothing');
    db.close();
  });
  after(async () => { await api.stop(); });

  it('returns only the items that name the server, and everything without the filter', async () => {
    const texts = async (q: string) => ((await api.call('GET', `/api/news${q}`)).body as { payload: { content: string } }[]).map((n) => n.payload.content).sort();
    assert.deepEqual(await texts(''), ['about nothing', 'about one', 'about two']);
    assert.deepEqual(await texts('?server=1'), ['about one']);
    assert.deepEqual(await texts('?server=3'), ['about two']);
    assert.deepEqual(await texts('?server=9'), []);
    assert.deepEqual(await texts('?server=abc'), ['about nothing', 'about one', 'about two'], 'a wrong value is ignored');
  });
});
