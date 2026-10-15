/** Autoroles, voice counters and the data of the info slash commands. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const H = { 'x-internal-token': 'i'.repeat(48) };
const HOUR = 3_600_000;
const G = '100000000000000001';
const ROLE = '100000000000000002';
const VOICE = '100000000000000003';
const did = (n: number) => String(300000000000000000n + BigInt(n));

describe('api: autoroles, counters, info commands', () => {
  let api: Api;
  let token = '';
  let a = 0;
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
    const db = new Database(api.dbPath);
    const now = Date.now();
    a = Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('Alpha', 'rust', '127.0.0.1', 28015, ?)").run(now).lastInsertRowid);
    // three linked accounts: Viktor plays now and has 20 h, Mira 3 h, Old has a nick but no Discord
    const user = db.prepare("INSERT INTO users (username, password_hash, role, discord_id) VALUES (?, 'x', 'player', ?)");
    const nick = db.prepare("INSERT INTO user_player (user_id, game_nick) VALUES (?, ?)");
    for (const [u, d, n] of [['viktor', did(1), 'Viktor'], ['mira', did(2), 'Mira'], ['old', null, 'Old']] as const) nick.run(Number(user.run(u, d).lastInsertRowid), n);
    const s = db.prepare('INSERT INTO player_sessions (server_id, name, joined_at, left_at) VALUES (?, ?, ?, ?)');
    s.run(a, 'viktor', now - 30 * HOUR, now - 10 * HOUR);
    s.run(a, 'Viktor', now - HOUR, null);
    s.run(a, 'Mira', now - 5 * HOUR, now - 2 * HOUR);
    s.run(a, 'Old', now - 50 * HOUR, now - 48 * HOUR);
    db.close();
    // what the bot reports: a role it can give and a voice channel it can rename
    const r = await api.call('POST', '/internal/bot-guilds', { headers: H, body: [{ id: G, name: 'Guild', channels: [], roles: [{ id: ROLE, name: 'В игре', color: 0x2ecc71 }], voice: [{ id: VOICE, name: 'Онлайн' }] }] });
    assert.equal(r.status, 200);
  });
  after(async () => { await api.stop(); });

  const rule = (kind: string, threshold = 0) => api.call('POST', '/api/discord/autoroles', { token, body: { guildId: G, roleId: ROLE, kind, threshold } });
  const sync = async () => (await api.call('GET', '/internal/discord/sync', { headers: H })).body;

  it('online, hours and week-top rules pick only linked accounts that qualify', async () => {
    const online = (await rule('online')).body.id;
    const hours = (await rule('hours', 10)).body.id;
    const top = (await rule('week_top', 2)).body.id;
    const s = await sync();
    const of = (id: number) => s.autoroles.find((x: { ruleId: number }) => x.ruleId === id);
    assert.deepEqual(of(online).add, [did(1)]);
    assert.deepEqual(of(hours).add, [did(1)]);
    assert.deepEqual(of(top).add.sort(), [did(1), did(2)]);
    assert.deepEqual(of(online).remove, []);
  });

  it('what the bot applied is remembered; a holder who no longer qualifies is to be removed', async () => {
    const s = await sync();
    const online = s.autoroles[0];
    let r = await api.call('POST', `/internal/discord/autoroles/${online.ruleId}`, { headers: H, body: { added: [did(1), did(2)], removed: [] } });
    assert.equal(r.status, 200);
    const again = (await sync()).autoroles[0];
    assert.deepEqual(again.add, []);
    assert.deepEqual(again.remove, [did(2)]); // Mira is not online
    r = await api.call('GET', '/api/discord/extras', { token });
    assert.equal(r.body.autoroles[0].members, 2);
    assert.equal(r.body.autoroles[0].roleName, 'В игре');
  });

  it('a counter channel gets its name from the template', async () => {
    let r = await api.call('POST', '/api/discord/counters', { token, body: { channelId: VOICE, template: '{status} Онлайн: {players} · {servers} серв.' } });
    assert.equal(r.status, 200);
    r = await api.call('POST', '/api/discord/counters', { token, body: { channelId: VOICE, template: 'x' } });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'counter_exists');
    const s = await sync();
    assert.equal(s.counters.length, 1);
    assert.match(s.counters[0].name, /Онлайн: \d+ · 1 серв\./);
    r = await api.call('GET', '/api/discord/extras', { token });
    assert.equal(r.body.counters[0].channelName, 'Онлайн');
  });

  it('info commands: online, top, player and the autocomplete', async () => {
    let r = await api.call('GET', '/internal/discord/online', { headers: H });
    assert.equal(r.body.servers.length, 1);
    r = await api.call('GET', '/internal/discord/top?period=week', { headers: H });
    assert.equal(r.body.top[0].name.toLowerCase(), 'viktor');
    r = await api.call('GET', '/internal/discord/player?nick=VIKTOR', { headers: H });
    assert.equal(r.body.online, true);
    r = await api.call('GET', '/internal/discord/player?nick=nobody', { headers: H });
    assert.equal(r.status, 404);
    r = await api.call('GET', '/internal/discord/suggest?what=server&q=alp', { headers: H });
    assert.deepEqual(r.body.items, [{ name: 'Alpha', value: String(a) }]);
    r = await api.call('GET', '/internal/discord/suggest?what=nick&q=mi', { headers: H });
    assert.deepEqual(r.body.items.map((x: { name: string }) => x.name), ['Mira']);
  });

  it('the panel endpoints are for the admin only, the internal ones need the token', async () => {
    assert.equal((await api.call('GET', '/api/discord/extras')).status, 401);
    assert.equal((await api.call('GET', '/internal/discord/sync')).status, 403);
  });
});
