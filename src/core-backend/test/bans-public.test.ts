/** The «Баны» page: what a guest sees and what only the staff sees, the filters, the short block after a kick that is not listed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-bans-'));
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ??= 'i'.repeat(48);
const { shapeBans } = await import('../src/gamenews/bansPublic.ts');
type Row = Parameters<typeof shapeBans>[0][number];

const row = (o: Partial<Row>): Row => ({ platform_id: '76561198000000011', nick: 'Alpha', reason: 'cheats', admin: 'Boss', created_at: 1000, until: 0, kind: 'ban', server_id: 1, scope: 'all', ...o });
const label = (id: number) => `Server ${id}`;

describe('the list of bans in the shape that is given out', () => {
  const rows = [
    row({}),
    row({ platform_id: '2', nick: 'Beta', reason: 'insults', scope: 'server', server_id: 2, until: 5000 }),
    row({ platform_id: '3', nick: 'Gamma', kind: 'block', reason: 'kick' }),
  ];
  it('shows a guest the nickname, the reason and the server, and not the account or the administrator', () => {
    const out = shapeBans(rows, { staff: false, label });
    assert.equal(out.length, 2, 'a short block after a kick is not a ban');
    for (const b of out) {
      assert.equal('admin' in b, false);
      assert.equal('platformId' in b, false);
    }
    assert.equal(out[0].server, 'Server 1');
  });
  it('shows the staff the account and who gave the ban', () => {
    const out = shapeBans(rows, { staff: true, label });
    assert.equal(out[0].admin, 'Boss');
    assert.equal(out[0].platformId, '76561198000000011');
  });
  it('filters by a server (a ban of all servers holds everywhere) and by a piece of the nickname or the reason', () => {
    assert.deepEqual(shapeBans(rows, { staff: false, server: 1, label }).map((b) => b.nick), ['Alpha']);
    assert.deepEqual(shapeBans(rows, { staff: false, server: 2, label }).map((b) => b.nick), ['Alpha', 'Beta']);
    assert.deepEqual(shapeBans(rows, { staff: false, q: 'INSULT', label }).map((b) => b.nick), ['Beta']);
    assert.deepEqual(shapeBans(rows, { staff: false, q: 'alp', label }).map((b) => b.nick), ['Alpha']);
  });
});

describe('api: /api/bans', () => {
  let api: Api;
  let token = '';
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('answers an open panel with an empty list and the figures, for a guest and for the staff', async () => {
    for (const t of [undefined, token]) {
      const r = await api.call('GET', '/api/bans', t ? { token: t } : {});
      assert.equal(r.status, 200);
      const b = r.body as { total: number; forever: number; last7d: number; servers: unknown[]; items: unknown[] };
      assert.deepEqual([b.total, b.forever, b.last7d, b.servers.length, b.items.length], [0, 0, 0, 0, 0]);
    }
  });
  it('wants a sign-in when the panel is closed to guests', async () => {
    const off = await api.call('PUT', '/api/access', { token, body: { publicPanel: false } });
    assert.ok(off.status < 300, `the switch works: ${off.status}`);
    assert.equal((await api.call('GET', '/api/bans')).status, 401);
    assert.equal((await api.call('GET', '/api/bans', { token })).status, 200);
  });
});

describe('api: the history, the appeals and the alerts of the bans', () => {
  let api: Api;
  let token = '';
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
    // the plugin has put two bans in force and the log knows a ban, an unban and a kick
    const { default: Database } = await import('better-sqlite3');
    const d = new Database(api.dbPath);
    const now = Date.now();
    d.prepare("INSERT INTO game_bans (platform_id, nick, reason, admin, created_at, until, kind, server_id, scope) VALUES ('p1', 'Cheater', 'aimbot', 'Boss', ?, 0, 'ban', 0, 'all')").run(now);
    d.prepare("INSERT INTO game_bans (platform_id, nick, reason, admin, created_at, until, kind, server_id, scope) VALUES ('p2', 'Rude', 'insults', 'Boss', ?, ?, 'ban', 0, 'all')").run(now, now + 86_400_000);
    const log = d.prepare("INSERT INTO game_mod_log (ts, kind, platform_id, nick, admin, reason, server_id, until) VALUES (?, ?, ?, ?, ?, ?, 0, ?)");
    log.run(now - 3000, 'ban', 'p1', 'Cheater', 'Boss', 'aimbot', 0);
    log.run(now - 2000, 'unban', 'p9', 'Forgiven', 'Boss', '', 0);
    log.run(now - 1000, 'kick', 'p8', 'Kicked', 'Boss', 'afk', 0);
    d.close();
  });
  after(async () => { await api.stop(); });

  it('tells the history of bans and unbans without the kicks and without the names of the staff for a guest', async () => {
    const g = (await api.call('GET', '/api/bans/history')).body as { items: { kind: string; nick: string; admin?: string }[] };
    assert.deepEqual(g.items.map((i) => `${i.kind}:${i.nick}`), ['unban:Forgiven', 'ban:Cheater']);
    assert.ok(g.items.every((i) => !('admin' in i)));
    const s = (await api.call('GET', '/api/bans/history', { token })).body as { items: { admin?: string }[] };
    assert.equal(s.items[0].admin, 'Boss');
  });

  it('takes an appeal only for a nickname with a ban in force, once, and lets only the staff read and decide', async () => {
    const send = (nick: string, text = 'I did nothing wrong, please check the log') => api.call('POST', '/api/bans/appeals', { body: { nick, text } });
    assert.equal((await send('Nobody')).status, 404, 'no ban, no appeal');
    assert.equal((await api.call('POST', '/api/bans/appeals', { body: { nick: 'Rude', text: 'short' } })).status, 400);
    const ok = await send('rude');
    assert.equal(ok.status, 201, 'the nickname is taken in any case');
    assert.equal((await send('Rude')).status, 409, 'one open appeal per nickname');
    assert.equal((await api.call('GET', '/api/bans/appeals')).status, 401);
    const list = (await api.call('GET', '/api/bans/appeals', { token })).body as { id: number; nick: string; status: string; platformId: string }[];
    assert.equal(list.length, 1);
    assert.equal(list[0].nick, 'Rude');
    assert.equal(list[0].platformId, 'p2');
    assert.equal((await api.call('PATCH', `/api/bans/appeals/${list[0].id}`, { body: { status: 'accepted', unban: true } })).status, 401);
    assert.equal((await api.call('PATCH', `/api/bans/appeals/${list[0].id}`, { token, body: { status: 'accepted', unban: true, note: 'first time' } })).status, 200);
    const left = (await api.call('GET', '/api/bans')).body as { items: { nick: string }[] };
    assert.deepEqual(left.items.map((b) => b.nick), ['Cheater'], 'the ban is lifted with the decision');
    const hist = (await api.call('GET', '/api/bans/history')).body as { items: { kind: string; nick: string }[] };
    assert.equal(hist.items[0].kind, 'unban');
    assert.equal((await api.call('PATCH', '/api/bans/appeals/9999', { token, body: { status: 'rejected' } })).status, 404);
  });

  it('keeps the switch of the push about bans for each member of the staff', async () => {
    assert.equal((await api.call('GET', '/api/bans/alerts')).status, 401);
    assert.deepEqual((await api.call('GET', '/api/bans/alerts', { token })).body, { on: false });
    assert.deepEqual((await api.call('PUT', '/api/bans/alerts', { token, body: { on: true } })).body, { on: true });
    assert.deepEqual((await api.call('GET', '/api/bans/alerts', { token })).body, { on: true });
  });

  it('shows the ban on the card of the player', async () => {
    const sid = ((await api.call('POST', '/api/servers', { token, body: { name: 'Card test', game: 'vrising', host: '127.0.0.1', port: 25597 } })).body as { id: number }).id;
    const d = (await import('better-sqlite3')).default;
    const db = new d(api.dbPath);
    db.prepare("INSERT INTO player_sessions (server_id, name, joined_at, left_at) VALUES (?, 'Cheater', ?, ?)").run(sid, Date.now() - 7200_000, Date.now() - 3600_000);
    db.close();
    const r = await api.call('GET', '/api/players/Cheater');
    assert.equal(r.status, 200);
    assert.equal((r.body as { ban: { reason: string } | null }).ban?.reason, 'aimbot');
  });
});

describe('api: the answer to an appeal reaches a signed-in author', () => {
  let api: Api;
  let admin = '';
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    const { default: Database } = await import('better-sqlite3');
    const d = new Database(api.dbPath);
    d.prepare("INSERT INTO game_bans (platform_id, nick, reason, admin, created_at, until, kind, server_id, scope) VALUES ('p7', 'Sorry', 'spam', 'Boss', ?, 0, 'ban', 0, 'all')").run(Date.now());
    d.close();
  });
  after(async () => { await api.stop(); });

  it('puts the decision into the bell of the person who sent the appeal while signed in', async () => {
    const reg = await api.call('POST', '/api/auth/register', { body: { username: 'appealer', password: 'Passw0rd!long', acceptRules: true } });
    const me = (reg.body as { token: string }).token;
    assert.equal((await api.call('POST', '/api/bans/appeals', { token: me, body: { nick: 'Sorry', text: 'It will not happen again, I promise' } })).status, 201);
    const list = (await api.call('GET', '/api/bans/appeals', { token: admin })).body as { id: number }[];
    assert.equal((await api.call('PATCH', `/api/bans/appeals/${list[0].id}`, { token: admin, body: { status: 'accepted', unban: true } })).status, 200);
    const inbox = (await api.call('GET', '/api/me/notifications', { token: me })).body as { items?: { kind: string; text: string }[] } | { kind: string; text: string }[];
    const items = Array.isArray(inbox) ? inbox : inbox.items ?? [];
    assert.ok(items.some((n) => n.kind === 'ban_appeal' && /бан снят/.test(n.text)), JSON.stringify(items));
  });
});

describe('api: a decision on a report can also be a ban', () => {
  let api: Api;
  let admin = '';
  let player = '';
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    player = ((await api.call('POST', '/api/auth/register', { body: { username: 'reporter_x', password: 'Passw0rd!long', acceptRules: true } })).body as { token: string }).token;
    const { default: Database } = await import('better-sqlite3');
    const d = new Database(api.dbPath);
    d.prepare("INSERT INTO game_mod_log (ts, kind, platform_id, nick, admin, reason, server_id, until) VALUES (?, 'kick', 'pg-1', 'Griefer', 'Boss', 'afk', 0, 0)").run(Date.now() - 5000);
    d.close();
  });
  after(async () => { await api.stop(); });

  it('bans a player whose game account is known, and says so when it is not', async () => {
    for (const nick of ['Griefer', 'Stranger']) assert.equal((await api.call('POST', `/api/players/${nick}/report`, { token: player, body: { reason: 'griefing', text: 'broke my base' } })).status < 300, true);
    const rows = (await api.call('GET', '/api/reports', { token: admin })).body as { id: number; nick: string }[];
    const idOf = (n: string) => rows.find((r) => r.nick === n)!.id;
    const unknown = await api.call('PATCH', `/api/reports/${idOf('Stranger')}`, { token: admin, body: { status: 'resolved', banHours: 24 } });
    assert.equal(unknown.status, 409);
    const ok = await api.call('PATCH', `/api/reports/${idOf('Griefer')}`, { token: admin, body: { status: 'resolved', note: 'griefing', banHours: 24 } });
    assert.equal(ok.status, 200);
    const list = (await api.call('GET', '/api/bans')).body as { items: { nick: string; reason: string; until: number }[] };
    const b = list.items.find((x) => x.nick === 'Griefer');
    assert.ok(b && b.reason === 'griefing' && b.until > Date.now(), JSON.stringify(list.items));
  });
});
