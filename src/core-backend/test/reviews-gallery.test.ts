/** Reviews of the servers and the screenshot gallery, with the staff's moderation. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import skia from 'skia-canvas';
import { setupAdmin, startBackend, type Api } from './harness.ts';

async function png(w: number, h: number): Promise<Buffer> {
  const c = new skia.Canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c33';
  ctx.fillRect(0, 0, w, h);
  return c.toBuffer('png');
}

describe('api: reviews and gallery', () => {
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

  it('gallery: a player upload waits for the staff and is private until approved', async () => {
    let r = await api.call('POST', `/api/gallery?serverId=${srv}&caption=${encodeURIComponent('Закат')}`, { token: p1, raw: await png(2400, 1200), headers: { 'content-type': 'image/png' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'pending');
    assert.equal(r.body.width, 1920);
    assert.equal(r.body.height, 960);
    const id = r.body.id;
    assert.equal((await api.call('GET', '/api/gallery')).body.length, 0);
    assert.equal((await fetch(`${api.base}/api/gallery/img/${id}.jpg`)).status, 404);
    assert.equal((await fetch(`${api.base}/api/gallery/img/${id}.jpg`, { headers: { authorization: `Bearer ${p1}` } })).status, 200);
    assert.equal((await api.call('PATCH', `/api/gallery/${id}`, { token: p1, body: { status: 'approved' } })).status, 403);
    r = await api.call('PATCH', `/api/gallery/${id}`, { token: admin, body: { status: 'approved', featured: true } });
    assert.equal(r.body.featured, true);
    const pub = (await api.call('GET', '/api/gallery')).body;
    assert.equal(pub.length, 1);
    assert.equal(pub[0].caption, 'Закат');
    assert.equal(pub[0].serverName, 'A');
    const img = await fetch(`${api.base}/api/gallery/img/${id}.jpg?s=1`);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
  });

  it('gallery: the staff upload is approved at once; a non-image is refused; only the author or staff delete', async () => {
    let r = await api.call('POST', '/api/gallery', { token: admin, raw: await png(300, 200), headers: { 'content-type': 'image/png' } });
    assert.equal(r.body.status, 'approved');
    const id = r.body.id;
    r = await api.call('POST', '/api/gallery', { token: p1, raw: Buffer.from('not an image'), headers: { 'content-type': 'image/png' } });
    assert.equal(r.status, 400);
    assert.equal((await api.call('DELETE', `/api/gallery/${id}`, { token: p2 })).status, 403);
    assert.equal((await api.call('DELETE', `/api/gallery/${id}`, { token: admin })).status, 200);
  });

  it('gallery: at most 5 pictures wait per player', async () => {
    const pic = await png(100, 100);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await api.call('POST', '/api/gallery', { token: p2, raw: pic, headers: { 'content-type': 'image/png' } })).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
  });
});
