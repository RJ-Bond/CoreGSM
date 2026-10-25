/** Views of a news item, the sort of the feed (?sort=) and the filter by author (?author=). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const channelId = '123456789012345678';

describe('news: views, sort, author', () => {
  let api: Api;
  let admin = '';
  let player = '';
  let db: Database.Database;
  const ids: number[] = [];

  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    player = (await api.call('POST', '/api/auth/register', { body: { username: 'reader_one', password: 'Passw0rd!long', acceptRules: true } })).body.token as string;
    db = new Database(api.dbPath);
    for (let i = 0; i < 3; i++) {
      const id = (await api.call('POST', '/api/news', { token: admin, body: { channelId, action: 'draft', payload: { content: `Новость ${i}` } } })).body.id as number;
      db.prepare("UPDATE news SET status = 'sent', sent_at = ?, message_id = '1' WHERE id = ?").run(Date.now() - (3 - i) * 60_000, id);
      ids.push(id);
    }
    // a news item written by nobody in particular (an import, an old row)
    db.prepare('UPDATE news SET created_by = NULL WHERE id = ?').run(ids[0]);
  });
  after(async () => {
    db.close();
    await api.stop();
  });

  it('counts a view and shows the total in the feed', async () => {
    assert.equal((await api.call('POST', `/api/news/${ids[1]}/view`, { token: player })).body.views, 1);
    assert.equal((await api.call('POST', `/api/news/${ids[1]}/view`, { token: player })).body.views, 2);
    const feed = await api.call('GET', '/api/news', { token: player });
    assert.equal(feed.body.find((n: { id: number }) => n.id === ids[1]).views, 2);
    assert.equal(feed.body.find((n: { id: number }) => n.id === ids[2]).views, 0);
  });

  it('does not count a view of an unpublished or missing item', async () => {
    const draft = (await api.call('POST', '/api/news', { token: admin, body: { channelId, action: 'draft', payload: { content: 'черновик' } } })).body.id as number;
    assert.equal((await api.call('POST', `/api/news/${draft}/view`, { token: player })).status, 404);
    assert.equal((await api.call('POST', '/api/news/99999/view', { token: player })).status, 404);
  });

  it('sorts the feed by reactions, comments and views', async () => {
    const order = async (sort: string) => ((await api.call('GET', `/api/news?sort=${sort}`, { token: player })).body as { id: number }[]).map((n) => n.id);
    // views: ids[1] has 2
    assert.equal((await order('viewed'))[0], ids[1]);
    // reactions: ids[0] gets one
    db.prepare("INSERT INTO news_reactions (news_id, user_id, emoji, ts) VALUES (?, 1, '👍', 1)").run(ids[0]);
    assert.equal((await order('top'))[0], ids[0]);
    // comments: ids[2] gets one
    db.prepare("INSERT INTO news_comments (news_id, user_id, text, created_at) VALUES (?, 1, 'x', ?)").run(ids[2], Date.now());
    assert.equal((await order('discussed'))[0], ids[2]);
    // the default order is the newest first
    assert.deepEqual(await order('new'), [ids[2], ids[1], ids[0]]);
  });

  it('filters by author and tells how many items an author has', async () => {
    const full = (await api.call('GET', `/api/news/${ids[1]}`, { token: player })).body;
    assert.ok(full.authorId > 0);
    assert.equal(full.authorCount, 2);
    const mine = (await api.call('GET', `/api/news?author=${full.authorId}`, { token: player })).body as { id: number }[];
    assert.deepEqual(mine.map((n) => n.id).sort(), [ids[1], ids[2]].sort());
    const none = (await api.call('GET', `/api/news/${ids[0]}`, { token: player })).body;
    assert.equal(none.authorId, null);
    assert.equal(none.authorCount, 0);
  });
});
