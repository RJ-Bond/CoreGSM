/** Reviews of the servers, with the staff's moderation. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('api: reviews', () => {
  let api: Api;
  let admin = '';
  let p1 = '';
  let p2 = '';
  let srv = 0;
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    const reg = async (username: string) => (await api.call('POST', '/api/auth/register', { body: { username, password: 'Passw0rd!long', acceptRules: true } })).body.token as string;
    p1 = await reg('player_one');
    p2 = await reg('player_two');
    const db = new Database(api.dbPath);
    srv = Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('A', 'rust', '127.0.0.1', 28015, ?)").run(Date.now()).lastInsertRowid);
    db.close();
  });
  after(async () => { await api.stop(); });

  it('reviews: one per player and server, the average and the spread', async () => {
    let r = await api.call('PUT', `/api/servers/${srv}/reviews`, { token: p1, body: { stars: 5, text: 'Отличный сервер' } });
    assert.equal(r.status, 200);
    r = await api.call('PUT', `/api/servers/${srv}/reviews`, { token: p1, body: { stars: 4, text: 'Хороший сервер' } });
    await api.call('PUT', `/api/servers/${srv}/reviews`, { token: p2, body: { stars: 2 } });
    r = await api.call('GET', `/api/servers/${srv}/reviews`, { token: p1 });
    assert.equal(r.body.count, 2);
    assert.equal(r.body.avg, 3);
    assert.deepEqual(r.body.dist, [0, 1, 0, 1, 0]);
    assert.equal(r.body.mine.text, 'Хороший сервер');
    assert.equal((await api.call('PUT', `/api/servers/${srv}/reviews`, { token: p1, body: { stars: 6 } })).status, 400);
    assert.equal((await api.call('PUT', `/api/servers/${srv}/reviews`, { body: { stars: 3 } })).status, 401);
  });

  it('a hidden review leaves the score and stays hidden after its author edits it', async () => {
    const list = (await api.call('GET', '/api/reviews', { token: admin })).body;
    const two = list.find((x: { stars: number }) => x.stars === 2);
    assert.equal((await api.call('PATCH', `/api/reviews/${two.id}`, { token: p1, body: { hidden: true } })).status, 403);
    assert.equal((await api.call('PATCH', `/api/reviews/${two.id}`, { token: admin, body: { hidden: true } })).status, 200);
    await api.call('PUT', `/api/servers/${srv}/reviews`, { token: p2, body: { stars: 1 } });
    const r = await api.call('GET', `/api/servers/${srv}/reviews`);
    assert.equal(r.body.count, 1);
    assert.equal(r.body.avg, 4);
    assert.equal(r.body.items.length, 1);
  });

  it('reviews: useful votes, the staff answer; a pinned note on the server', async () => {
    const rid = (await api.call('GET', `/api/servers/${srv}/reviews`, { token: p2 })).body.items[0].id as number;
    assert.equal((await api.call('PUT', `/api/reviews/${rid}/vote`, { token: p1 })).status, 400); // one's own review
    let r = await api.call('PUT', `/api/reviews/${rid}/vote`, { token: p2 });
    assert.equal(r.status, 200);
    assert.equal(r.body.votes, 1);
    r = await api.call('GET', `/api/servers/${srv}/reviews`, { token: p2 });
    assert.equal(r.body.items[0].votes, 1);
    assert.equal(r.body.items[0].voted, true);
    r = await api.call('GET', `/api/servers/${srv}/reviews`);
    assert.equal(r.body.items[0].voted, false);
    assert.equal((await api.call('DELETE', `/api/reviews/${rid}/vote`, { token: p2 })).body.votes, 0);

    assert.equal((await api.call('PUT', `/api/reviews/${rid}/reply`, { token: p1, body: { text: 'Спасибо' } })).status, 403);
    assert.equal((await api.call('PUT', `/api/reviews/${rid}/reply`, { token: admin, body: { text: 'Спасибо за отзыв!' } })).status, 200);
    assert.equal((await api.call('GET', `/api/servers/${srv}/reviews`)).body.items[0].reply, 'Спасибо за отзыв!');

    assert.equal((await api.call('PUT', `/api/servers/${srv}/notice`, { token: p1, body: { text: 'Вайп в пятницу' } })).status, 403);
    assert.equal((await api.call('PUT', `/api/servers/${srv}/notice`, { token: admin, body: { text: 'Вайп в пятницу', tone: 'warn' } })).status, 200);
    let d = await api.call('GET', `/api/servers/${srv}/details`);
    assert.equal(d.body.notice.text, 'Вайп в пятницу');
    assert.equal(d.body.notice.tone, 'warn');
    await api.call('PUT', `/api/servers/${srv}/notice`, { token: admin, body: { text: '' } });
    d = await api.call('GET', `/api/servers/${srv}/details`);
    assert.equal(d.body.notice, null);
  });
});
