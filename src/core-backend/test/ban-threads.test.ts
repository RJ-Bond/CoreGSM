/** The conversation under an appeal, and the notices «the ban ends soon / has ended». */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('api: the conversation under an appeal', () => {
  let api: Api;
  let admin = '';
  let author = '';
  let stranger = '';
  let id = 0;
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    const { default: Database } = await import('better-sqlite3');
    const d = new Database(api.dbPath);
    d.prepare("INSERT INTO game_bans (platform_id, nick, reason, admin, created_at, until, kind, server_id, scope) VALUES ('pt1', 'Talker', 'spam', 'Boss', ?, 0, 'ban', 0, 'all')").run(Date.now());
    d.close();
    author = ((await api.call('POST', '/api/auth/register', { body: { username: 'talker_a', password: 'Passw0rd!long', acceptRules: true } })).body as { token: string }).token;
    stranger = ((await api.call('POST', '/api/auth/register', { body: { username: 'talker_b', password: 'Passw0rd!long', acceptRules: true } })).body as { token: string }).token;
    assert.equal((await api.call('POST', '/api/bans/appeals', { token: author, body: { nick: 'Talker', text: 'It was a misunderstanding, please check' } })).status, 201);
    id = ((await api.call('GET', '/api/bans/appeals', { token: admin })).body as { id: number }[])[0].id;
  });
  after(async () => { await api.stop(); });

  it('is closed to anybody but the staff and the author', async () => {
    assert.equal((await api.call('GET', `/api/bans/appeals/${id}/messages`)).status, 401);
    assert.equal((await api.call('GET', `/api/bans/appeals/${id}/messages`, { token: stranger })).status, 404);
    assert.equal((await api.call('POST', `/api/bans/appeals/${id}/messages`, { token: stranger, body: { text: 'hello' } })).status, 404);
  });

  it('lets the staff ask and the author answer, and tells each side', async () => {
    assert.equal((await api.call('POST', `/api/bans/appeals/${id}/messages`, { token: admin, body: { text: 'On which server did it happen?' } })).status, 201);
    const inbox = (await api.call('GET', '/api/me/notifications', { token: author })).body as { items?: { kind: string; text: string }[] } | { kind: string; text: string }[];
    const items = Array.isArray(inbox) ? inbox : inbox.items ?? [];
    assert.ok(items.some((n) => n.kind === 'ban_appeal' && /ответил/.test(n.text)), JSON.stringify(items));
    assert.equal((await api.call('POST', `/api/bans/appeals/${id}/messages`, { token: author, body: { text: 'On the second one.' } })).status, 201);
    const th = (await api.call('GET', `/api/bans/appeals/${id}/messages`, { token: author })).body as { appeal: { canReply: boolean }; messages: { side: string; text: string }[] };
    assert.deepEqual(th.messages.map((m) => m.side), ['staff', 'player']);
    assert.equal(th.appeal.canReply, true);
    const counts = (await api.call('GET', '/api/bans/appeals-counts', { token: admin })).body as Record<string, { messages: number; fromPlayer: number }>;
    assert.equal(counts[id].messages, 2);
    assert.equal(counts[id].fromPlayer, 1);
    const mine = (await api.call('GET', '/api/bans/appeals/mine', { token: author })).body as { id: number; messages: number }[];
    assert.equal(mine[0].messages, 2);
  });

  it('rejects an empty message and closes the conversation with the decision', async () => {
    assert.equal((await api.call('POST', `/api/bans/appeals/${id}/messages`, { token: author, body: { text: '   ' } })).status, 400);
    assert.equal((await api.call('PATCH', `/api/bans/appeals/${id}`, { token: admin, body: { status: 'rejected', note: 'no' } })).status, 200);
    assert.equal((await api.call('POST', `/api/bans/appeals/${id}/messages`, { token: author, body: { text: 'one more' } })).status, 409);
    const th = (await api.call('GET', `/api/bans/appeals/${id}/messages`, { token: author })).body as { appeal: { canReply: boolean } };
    assert.equal(th.appeal.canReply, false);
  });
});

describe('the notice that a ban ends', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-bend-'));
  process.env.JWT_SECRET ||= 'j'.repeat(48);
  process.env.INTERNAL_TOKEN ||= 'i'.repeat(48);
  process.env.DB_PATH = path.join(tmp, 'coregsm.db');
  process.env.NODE_ENV = 'test';
  const NOW = 1_800_000_000_000;

  it('tells the linked account once that the ban ends soon, and once that it has ended', async () => {
    const { db } = await import('../src/db.ts');
    const { checkBanEnds } = await import('../src/gamenews/banThreads.ts');
    const uid = Number(db.prepare("INSERT INTO users (username, password_hash, role, status) VALUES ('linked', 'x', 'player', 'active')").run().lastInsertRowid);
    db.prepare("INSERT INTO game_identities (platform_id, user_id, created_at) VALUES ('pe1', ?, 1)").run(uid);
    db.prepare("INSERT INTO game_bans (platform_id, nick, reason, admin, created_at, until, kind, server_id, scope) VALUES ('pe1', 'Ender', 'x', 'Boss', ?, ?, 'ban', 0, 'all')").run(NOW - 86_400_000, NOW + 3_600_000);
    const texts = () => (db.prepare('SELECT text FROM user_notifications WHERE user_id = ? ORDER BY id').all(uid) as { text: string }[]).map((r) => r.text);

    assert.equal(checkBanEnds(NOW), 1);
    assert.equal(checkBanEnds(NOW + 60_000), 0, 'told once');
    assert.equal(texts().length, 1);
    assert.match(texts()[0], /Ender/);

    db.prepare("DELETE FROM game_bans WHERE platform_id = 'pe1'").run();
    assert.equal(checkBanEnds(NOW + 2 * 3_600_000), 1);
    assert.match(texts()[1], /истёк/);
    assert.equal(checkBanEnds(NOW + 3 * 3_600_000), 0);
  });

  it('says nothing to a ban that is far off, for ever, or lifted earlier by a longer one', async () => {
    const { db } = await import('../src/db.ts');
    const { checkBanEnds } = await import('../src/gamenews/banThreads.ts');
    const uid = Number(db.prepare("INSERT INTO users (username, password_hash, role, status) VALUES ('linked2', 'x', 'player', 'active')").run().lastInsertRowid);
    db.prepare("INSERT INTO game_identities (platform_id, user_id, created_at) VALUES ('pe2', ?, 1)").run(uid);
    db.prepare("INSERT INTO game_bans (platform_id, nick, reason, admin, created_at, until, kind, server_id, scope) VALUES ('pe2', 'Far', 'x', 'Boss', ?, ?, 'ban', 0, 'all')").run(NOW, NOW + 10 * 86_400_000);
    db.prepare("INSERT INTO game_bans (platform_id, nick, reason, admin, created_at, until, kind, server_id, scope) VALUES ('pe3', 'Forever', 'x', 'Boss', ?, 0, 'ban', 0, 'all')").run(NOW);
    assert.equal(checkBanEnds(NOW), 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ?').get(uid) as { n: number }).n, 0);
  });
});
