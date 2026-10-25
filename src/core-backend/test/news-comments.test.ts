/** Comments under a news item: thread, replies, edit window, reactions, flags, moderation, notifications. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const channelId = '123456789012345678';

describe('news comments', () => {
  let api: Api;
  let admin = '';
  let one = '';
  let two = '';
  let db: Database.Database;
  let news = 0;
  let draft = 0;

  // the spam limit (8 in 10 minutes) is not under test here: age the earlier comments a little before each post
  const post = (token: string, text: string, parentId?: number, id = news) => {
    db.prepare('UPDATE news_comments SET created_at = created_at - 700000 WHERE created_at > ?').run(Date.now() - 3 * 3600_000);
    return send(token, text, parentId, id);
  };
  const send = (token: string, text: string, parentId?: number, id = news) => api.call('POST', `/api/news/${id}/comments`, { token, body: { text, ...(parentId ? { parentId } : {}) } });
  const items = async (token = one) => (await api.call('GET', `/api/news/${news}/comments`, { token })).body.items as { id: number; parentId: number | null; text: string; hidden: boolean; deleted: boolean; pinned: boolean; reactions: Record<string, number>; flags?: number }[];
  const inbox = async (token: string) => (await api.call('GET', '/api/me/notifications', { token })).body.items as { kind: string; text: string; url: string | null }[];

  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    const reg = async (username: string) => (await api.call('POST', '/api/auth/register', { body: { username, password: 'Passw0rd!long', acceptRules: true } })).body.token as string;
    one = await reg('player_one');
    two = await reg('player_two');
    db = new Database(api.dbPath);
    const mk = async () => (await api.call('POST', '/api/news', { token: admin, body: { channelId, action: 'draft', payload: { content: 'Новость' } } })).body.id as number;
    news = await mk();
    draft = await mk();
    db.prepare("UPDATE news SET status = 'sent', sent_at = ?, message_id = '1' WHERE id = ?").run(Date.now(), news);
  });
  after(async () => {
    db.close();
    await api.stop();
  });

  it('is closed for guests and for unpublished news', async () => {
    assert.equal((await api.call('POST', `/api/news/${news}/comments`, { body: { text: 'hi' } })).status, 401);
    assert.equal((await post(one, 'hi', undefined, draft)).status, 404);
  });

  it('validates the text', async () => {
    const r = await post(one, 'x'.repeat(1001));
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'comment_bad');
    assert.equal((await post(one, '   ')).status, 400);
  });

  it('keeps replies one level deep and tells the author about them', async () => {
    const top = (await post(one, 'Первый!')).body.id as number;
    const reply = (await post(two, 'Ответ', top)).body.id as number;
    const deep = (await post(one, 'Ответ на ответ', reply)).body.id as number;
    const l = await items();
    assert.equal(l.find((x) => x.id === deep)?.parentId, top);
    assert.ok((await inbox(one)).some((n) => n.kind === 'news_reply' && n.url === `/news/${news}#c-${reply}`));
    assert.equal((await send(one, 'Первый!')).body.code, 'comment_dup');
  });

  it('notifies a mentioned user and collapses the notices for the news author', async () => {
    await post(one, 'Привет, @player_two!');
    assert.ok((await inbox(two)).some((n) => n.kind === 'news_mention'));
    await post(two, 'Ещё один');
    const mine = (await inbox(admin)).filter((n) => n.kind === 'news_comment');
    assert.equal(mine.length, 1);
    assert.match(mine[0].text, /\((\d+)\)$/);
    assert.ok(Number(/\((\d+)\)$/.exec(mine[0].text)![1]) >= 3);
  });

  it('edits within ten minutes only, and only your own', async () => {
    const id = (await post(one, 'Для правки')).body.id as number;
    assert.equal((await api.call('PATCH', `/api/news/comments/${id}`, { token: two, body: { text: 'чужое' } })).status, 403);
    assert.equal((await api.call('PATCH', `/api/news/comments/${id}`, { token: one, body: { text: 'Исправлено' } })).status, 200);
    assert.equal((await items()).find((x) => x.id === id)?.text, 'Исправлено');
    db.prepare('UPDATE news_comments SET created_at = ? WHERE id = ?').run(Date.now() - 11 * 60_000, id);
    const late = await api.call('PATCH', `/api/news/comments/${id}`, { token: one, body: { text: 'поздно' } });
    assert.equal(late.status, 403);
    assert.equal(late.body.code, 'comment_edit_late');
  });

  it('deletes your own comment and keeps a stub while it has replies', async () => {
    const top = (await post(one, 'Удалить меня')).body.id as number;
    await post(two, 'Под ним', top);
    assert.equal((await api.call('DELETE', `/api/news/comments/${top}`, { token: one })).status, 200);
    const stub = (await items()).find((x) => x.id === top);
    assert.ok(stub?.deleted);
    assert.equal(stub?.text, '');
    const lone = (await post(one, 'Одинокий')).body.id as number;
    await api.call('DELETE', `/api/news/comments/${lone}`, { token: one });
    assert.equal((await items()).some((x) => x.id === lone), false);
  });

  it('counts reactions, one per user, only the known emoji', async () => {
    const id = (await post(one, 'Реакции')).body.id as number;
    assert.equal((await api.call('PUT', `/api/news/comments/${id}/reaction`, { token: two, body: { emoji: '🔥' } })).status, 200);
    assert.equal((await api.call('PUT', `/api/news/comments/${id}/reaction`, { token: two, body: { emoji: '👍' } })).status, 200);
    assert.deepEqual((await items()).find((x) => x.id === id)?.reactions, { '👍': 1 });
    assert.equal((await api.call('PUT', `/api/news/comments/${id}/reaction`, { token: two, body: { emoji: '💩' } })).status, 400);
  });

  it('collects complaints and lets a moderator hide, approve and pin', async () => {
    const id = (await post(one, 'Спорный')).body.id as number;
    assert.equal((await api.call('POST', `/api/news/comments/${id}/flag`, { token: one })).status, 403);
    assert.equal((await api.call('POST', `/api/news/comments/${id}/flag`, { token: two })).status, 200);
    assert.equal((await api.call('GET', '/api/news/comments/count', { token: admin })).body.open, 1);
    assert.equal((await api.call('GET', '/api/news/comments/count', { token: two })).status, 403);
    const q = await api.call('GET', '/api/news/comments/queue', { token: admin });
    assert.equal(q.body[0].id, id);
    assert.equal(q.body[0].flags, 1);

    assert.equal((await api.call('POST', `/api/news/comments/${id}/hide`, { token: admin, body: { reason: 'Оскорбление' } })).status, 200);
    const seen = (await items(two)).find((x) => x.id === id);
    assert.ok(seen?.hidden);
    assert.equal(seen?.text, '');
    assert.equal((await items(one)).find((x) => x.id === id)?.text, 'Спорный');
    assert.ok((await inbox(one)).some((n) => n.kind === 'news_hidden' && n.text.includes('Оскорбление')));

    await api.call('POST', '/api/news/comments/bulk', { token: admin, body: { ids: [id], action: 'approve' } });
    assert.equal((await items(two)).find((x) => x.id === id)?.hidden, false);

    assert.equal((await api.call('POST', `/api/news/comments/${id}/pin`, { token: admin, body: { pinned: true } })).status, 200);
    const other = (await post(two, 'Другой')).body.id as number;
    await api.call('POST', `/api/news/comments/${other}/pin`, { token: admin, body: { pinned: true } });
    const pins = (await items()).filter((x) => x.pinned).map((x) => x.id);
    assert.deepEqual(pins, [other]);
    const reply = (await post(one, 'Ответ', other)).body.id as number;
    assert.equal((await api.call('POST', `/api/news/comments/${reply}/pin`, { token: admin, body: { pinned: true } })).body.code, 'comment_pin_bad');
  });

  it('shows the count in the feed and the most discussed news', async () => {
    const feed = await api.call('GET', '/api/news', { token: one });
    assert.ok(feed.body.find((n: { id: number }) => n.id === news).comments > 3);
    const hot = await api.call('GET', '/api/news/discussed', { token: one });
    assert.equal(hot.body[0].id, news);
  });

  it('can be closed for one news item and for the whole site', async () => {
    assert.equal((await api.call('PUT', `/api/news/${news}/comments/lock`, { token: two, body: { locked: true } })).status, 403);
    assert.equal((await api.call('PUT', `/api/news/${news}/comments/lock`, { token: admin, body: { locked: true } })).status, 200);
    const closed = await post(one, 'Поздно');
    assert.equal(closed.status, 403);
    assert.equal(closed.body.code, 'comments_closed');
    assert.equal((await api.call('GET', `/api/news/${news}/comments`, { token: one })).body.canPost, false);
    await api.call('PUT', `/api/news/${news}/comments/lock`, { token: admin, body: { locked: false } });
    await api.call('PUT', '/api/news/comments/settings', { token: admin, body: { enabled: false } });
    const off = await api.call('GET', `/api/news/${news}/comments`, { token: one });
    assert.equal(off.body.enabled, false);
    assert.deepEqual(off.body.items, []);
    await api.call('PUT', '/api/news/comments/settings', { token: admin, body: { enabled: true } });
  });
});
