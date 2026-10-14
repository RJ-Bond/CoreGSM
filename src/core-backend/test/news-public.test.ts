import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const channelId = '123456789012345678';
const HEART = '❤️';

describe('news: public fields, reactions, neighbours', () => {
  let api: Api;
  let admin = '';
  let player = '';
  let player2 = '';
  let db: Database.Database;
  const ids: number[] = [];

  const create = async (payload: Record<string, unknown>, token = admin) =>
    api.call('POST', '/api/news', { token, body: { channelId, action: 'draft', payload } });
  const publish = (id: number, sentAt: number) =>
    db.prepare("UPDATE news SET status = 'sent', sent_at = ?, message_id = '1' WHERE id = ?").run(sentAt, id);

  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    const reg = async (username: string) => {
      const r = await api.call('POST', '/api/auth/register', { body: { username, password: 'Passw0rd!long', acceptRules: true } });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.token as string;
    };
    player = await reg('player_one');
    player2 = await reg('player_two');
    db = new Database(api.dbPath);
  });
  after(async () => {
    db.close();
    await api.stop();
  });

  it('validates the new payload fields', async () => {
    const base = { content: 'x' };
    const bad = async (extra: Record<string, unknown>) => assert.equal((await create({ ...base, ...extra })).status, 400, JSON.stringify(extra));
    await bad({ category: 'nope' });
    await bad({ actions: [{ label: 'Go', url: 'http://example.com' }] });
    await bad({ actions: Array.from({ length: 4 }, () => ({ label: 'a', url: 'https://example.com' })) });
    await bad({ gallery: Array.from({ length: 7 }, () => ({ url: 'https://example.com/a.png' })) });
    await bad({ gallery: [{ url: 'http://example.com/a.png' }] });
    await bad({ changes: Array.from({ length: 21 }, () => ({ kind: 'add', text: 'a' })) });
    await bad({ changes: [{ kind: 'add', text: '' }] });
    await bad({ changes: [{ kind: 'zzz', text: 'a' }] });
    await bad({ countdownLabel: 'x'.repeat(61) });
    await bad({ game: 'no-such-game' });

    const ok = await create({
      ...base,
      category: 'wipe',
      pinned: true,
      game: '',
      gallery: [{ url: 'https://example.com/a.png' }],
      changes: [{ kind: 'fix', text: ' Fixed ' }],
      countdownAt: Date.now() + 1000,
      countdownLabel: 'Wipe',
      actions: [{ label: 'Open', url: 'https://example.com' }],
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.category, 'wipe');
    assert.equal(ok.body.pinned, true);
    assert.equal(ok.body.payload.changes[0].text, 'Fixed');
    assert.equal(ok.body.authorRole, 'admin');
    assert.deepEqual(ok.body.reactions, []);
  });

  it('orders the public list with pinned items first and exposes authorRole', async () => {
    const now = Date.now();
    const mk = async (title: string, extra: Record<string, unknown>, at: number) => {
      const r = await create({ content: title, ...extra });
      assert.equal(r.status, 201);
      publish(r.body.id, at);
      ids.push(r.body.id);
      return r.body.id as number;
    };
    const a = await mk('A oldest', {}, now - 5000);
    const b = await mk('B', { category: 'update' }, now - 4000);
    const c = await mk('C pinned old', { pinned: true }, now - 3000);
    const d = await mk('D newest', {}, now - 1000);
    const e = await mk('E pinned newer', { pinned: true }, now - 2000);
    // a draft must never be public
    const draft = await create({ content: 'draft' });
    assert.equal(draft.status, 201);

    const list = await api.call('GET', '/api/news');
    assert.equal(list.status, 200);
    const got = (list.body as { id: number }[]).map((x) => x.id).filter((x) => ids.includes(x));
    assert.deepEqual(got, [e, c, d, b, a]);
    assert.ok(!(list.body as { id: number }[]).some((x) => x.id === draft.body.id));
    const item = (list.body as any[]).find((x) => x.id === b);
    assert.equal(item.category, 'update');
    assert.equal(item.pinned, false);
    assert.equal(item.authorRole, 'admin');
    assert.equal((list.body as any[]).find((x) => x.id === a).category, 'announcement');

    // an old item without a creator has a null role
    db.prepare('UPDATE news SET created_by = NULL WHERE id = ?').run(a);
    const l2 = await api.call('GET', '/api/news');
    assert.equal((l2.body as any[]).find((x) => x.id === a).authorRole, null);

    // staff can pin / unpin
    const pin = await api.call('PATCH', `/api/news/${a}/pin`, { token: admin, body: { pinned: true } });
    assert.equal(pin.status, 200);
    assert.equal(pin.body.pinned, true);
    assert.equal((await api.call('PATCH', `/api/news/${a}/pin`, { token: player, body: { pinned: true } })).status, 403);
    const l3 = await api.call('GET', '/api/news');
    assert.equal((l3.body as any[]).filter((x) => ids.includes(x.id))[0].id, e);
    await api.call('PATCH', `/api/news/${a}/pin`, { token: admin, body: { pinned: false } });
  });

  it('returns one item with prev/next and 404 for drafts', async () => {
    // time order (newest first): D, E, C, B, A
    const [a, b, c, d, e] = ids;
    const mid = await api.call('GET', `/api/news/${c}`);
    assert.equal(mid.status, 200);
    assert.equal(mid.body.prev.id, e);
    assert.equal(mid.body.next.id, b);
    assert.equal(typeof mid.body.prev.title, 'string');
    assert.equal((await api.call('GET', `/api/news/${d}`)).body.prev, null);
    assert.equal((await api.call('GET', `/api/news/${a}`)).body.next, null);

    const draft = await create({ content: 'secret draft' });
    assert.equal((await api.call('GET', `/api/news/${draft.body.id}`)).status, 404);
    assert.equal((await api.call('GET', '/api/news/999999')).status, 404);
    // staff still see a draft
    assert.equal((await api.call('GET', `/api/news/${draft.body.id}`, { token: admin })).status, 200);
  });

  it('sets, changes and clears reactions', async () => {
    const id = ids[0];
    assert.equal((await api.call('PUT', `/api/news/${id}/reaction`, { body: { emoji: '👍' } })).status, 401);
    assert.equal((await api.call('PUT', `/api/news/${id}/reaction`, { token: player, body: { emoji: '🤡' } })).status, 400);

    const r1 = await api.call('PUT', `/api/news/${id}/reaction`, { token: player, body: { emoji: '👍' } });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.deepEqual(r1.body, [{ emoji: '👍', count: 1, mine: true }]);

    const r2 = await api.call('PUT', `/api/news/${id}/reaction`, { token: player2, body: { emoji: HEART } });
    assert.deepEqual(r2.body, [
      { emoji: '👍', count: 1, mine: false },
      { emoji: HEART, count: 1, mine: true },
    ]);

    // changing replaces the single reaction
    const r3 = await api.call('PUT', `/api/news/${id}/reaction`, { token: player, body: { emoji: '🔥' } });
    assert.deepEqual(r3.body, [
      { emoji: '🔥', count: 1, mine: true },
      { emoji: HEART, count: 1, mine: false },
    ]);

    // public view: counts for everyone, `mine` only for the signed-in user
    const anon = await api.call('GET', `/api/news/${id}`);
    assert.ok(anon.body.reactions.every((x: { mine: boolean }) => x.mine === false));
    assert.equal(anon.body.reactions.length, 2);
    const mine = await api.call('GET', '/api/news', { token: player });
    assert.deepEqual((mine.body as any[]).find((x) => x.id === id).reactions.filter((x: any) => x.mine).map((x: any) => x.emoji), ['🔥']);

    const r4 = await api.call('PUT', `/api/news/${id}/reaction`, { token: player, body: { emoji: null } });
    assert.deepEqual(r4.body, [{ emoji: HEART, count: 1, mine: false }]);

    // only published items accept reactions
    const draft = await create({ content: 'd2' });
    assert.equal((await api.call('PUT', `/api/news/${draft.body.id}/reaction`, { token: player, body: { emoji: '👍' } })).status, 404);
  });

  it('records the creator role of a moderator-made item', async () => {
    db.prepare("UPDATE users SET role = 'moderator' WHERE username = 'player_two'").run();
    const r = await create({ content: 'by mod' }, player2);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.authorRole, 'moderator');
  });
});
