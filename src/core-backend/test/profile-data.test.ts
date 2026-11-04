/** Privacy of the public profile, the data export, deleting the account and the profile card picture. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';
import { hoursText, hueOf, initialOf } from '../src/images/profileCardLogic.ts';
import { parsePrivacy } from '../src/profile/profileCore.ts';

describe('profile card logic', () => {
  it('writes hours the way a player reads them', () => {
    assert.equal(hoursText(0), '0 ч');
    assert.equal(hoursText(0.5), '30 мин');
    assert.equal(hoursText(94.24), '94 ч');
    assert.equal(hoursText(9.46), '9,5 ч');
  });
  it('picks a stable colour and an initial', () => {
    assert.equal(hueOf('Ren'), hueOf('rEN'));
    assert.ok(hueOf('Ren') >= 0 && hueOf('Ren') < 360);
    assert.equal(initialOf(' ren'), 'R');
    assert.equal(initialOf(''), '?');
  });
  it('privacy: everything is shown until switched off, junk means the defaults', () => {
    assert.deepEqual(parsePrivacy(''), { stats: true, achievements: true, online: true });
    assert.deepEqual(parsePrivacy('{"stats":false}'), { stats: false, achievements: true, online: true });
    assert.deepEqual(parsePrivacy('not json'), { stats: true, achievements: true, online: true });
  });
});

describe('api: privacy, export, deleting the account, the card', () => {
  let api: Api;
  let admin = '';
  let player = '';
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    player = (await api.call('POST', '/api/auth/register', { body: { username: 'Ren', password: 'Passw0rd!long', acceptRules: true } })).body.token as string;
    const db = new Database(api.dbPath);
    const srv = Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('Alpha', 'rust', '127.0.0.1', 28015, ?)").run(Date.now()).lastInsertRowid);
    // one finished visit and one that is going on now
    const s = db.prepare('INSERT INTO player_sessions (server_id, name, joined_at, left_at) VALUES (?, ?, ?, ?)');
    s.run(srv, 'RenInGame', Date.now() - 5 * 3600_000, Date.now() - 4 * 3600_000);
    s.run(srv, 'RenInGame', Date.now() - 600_000, null);
    db.close();
    await api.call('PUT', '/api/me/player', { token: player, body: { gameNick: 'RenInGame', bio: 'hi', publicProfile: true } });
  });
  after(async () => { await api.stop(); });

  it('a public profile shows the stats and where the player is now', async () => {
    const r = await api.call('GET', '/api/u/Ren');
    assert.equal(r.status, 200);
    assert.ok(r.body.stats.totalSeconds > 0);
    assert.equal(r.body.playingNow.name, 'Alpha');
    assert.deepEqual(r.body.privacy, { stats: true, achievements: true, online: true });
  });

  it('the owner can hide the stats, the achievements and the online status one by one', async () => {
    const r = await api.call('PUT', '/api/me/player', { token: player, body: { privacy: { online: false } } });
    assert.equal(r.body.privacy.online, false);
    assert.equal(r.body.privacy.stats, true);
    let pub = (await api.call('GET', '/api/u/Ren')).body;
    assert.equal(pub.playingNow, null);
    assert.ok(pub.stats);
    await api.call('PUT', '/api/me/player', { token: player, body: { privacy: { stats: false, achievements: false } } });
    pub = (await api.call('GET', '/api/u/Ren')).body;
    assert.equal(pub.stats, null);
    assert.equal(pub.rank, null);
    assert.deepEqual(pub.achievements, []);
    assert.deepEqual(pub.vrAchievements, []);
    // the owner's own page still has everything
    assert.ok((await api.call('GET', '/api/me/stats', { token: player })).body.totalSeconds > 0);
    await api.call('PUT', '/api/me/player', { token: player, body: { privacy: { stats: true, achievements: true, online: true } } });
  });

  it('the card is a PNG for a public profile and 404 otherwise', async () => {
    const res = await fetch(`${api.base}/api/u/Ren/card.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(1, 4).toString(), 'PNG');
    assert.equal((await fetch(`${api.base}/api/u/nobody/card.png`)).status, 404);
    await api.call('PUT', '/api/me/player', { token: player, body: { publicProfile: false } });
    assert.equal((await fetch(`${api.base}/api/u/Ren/card.png`)).status, 404);
    await api.call('PUT', '/api/me/player', { token: player, body: { publicProfile: true } });
  });

  it('the export is a JSON file with the account data and no secrets', async () => {
    assert.equal((await api.call('GET', '/api/me/export')).status, 401);
    const res = await fetch(`${api.base}/api/me/export`, { headers: { authorization: `Bearer ${player}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="coregsm-Ren\.json"/);
    const text = await res.text();
    const j = JSON.parse(text);
    assert.equal(j.account.username, 'Ren');
    assert.equal(j.player.game_nick, 'RenInGame');
    assert.equal(j.playSessions.length, 2);
    assert.ok(Array.isArray(j.journal));
    assert.ok(!/password|token|hash|secret/i.test(text.replace(/"(ua|detail)":\s*"[^"]*"/g, '')));
  });

  it('deleting the account needs the password; the last administrator stays', async () => {
    assert.equal((await api.call('DELETE', '/api/me', { token: player, body: { password: 'wrong-password' } })).status, 403);
    assert.equal((await api.call('DELETE', '/api/me', { token: admin, body: { password: 'Passw0rd!long' } })).status, 409);
    const r = await api.call('DELETE', '/api/me', { token: player, body: { password: 'Passw0rd!long' } });
    assert.equal(r.status, 200);
    assert.equal((await api.call('GET', '/api/me', { token: player })).status, 401);
    assert.equal((await api.call('GET', '/api/u/Ren')).status, 404);
    const db = new Database(api.dbPath);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'Ren'").get() as { n: number }).n, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM user_player').get() as { n: number }).n, 0);
    db.close();
  });
});
