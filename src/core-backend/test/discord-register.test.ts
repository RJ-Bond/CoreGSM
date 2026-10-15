/** Registration from Discord slash commands: pure name helpers and the internal routes over a real backend. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { cleanGameNick, sanitizeLogin, uniqueLogin } from '../src/discordNames.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const LOGIN_RE = /^(?=.{3,32}$)[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u;

describe('discord names (pure)', () => {
  it('keeps letters of any alphabet, digits and _ . -', () => {
    assert.equal(sanitizeLogin('Вася_Пупкин-7', '123456789012345678'), 'Вася_Пупкин-7');
    assert.equal(sanitizeLogin('Mixed Case.Name', '111111111111111111'), 'Mixed Case.Name');
  });
  it('drops emoji and other characters, collapses spaces', () => {
    assert.equal(sanitizeLogin('  Dark  ⚔️  Lord 🧛 ', '123456789012345678'), 'Dark Lord');
    assert.equal(sanitizeLogin('a<b>c', '123456789012345678'), 'abc');
  });
  it('pads short or empty names with the last 4 digits of the id', () => {
    assert.equal(sanitizeLogin('Jo', '123456789012345678'), 'Jo 5678');
    assert.equal(sanitizeLogin('🧛🧛🧛', '123456789012345678'), 'player 5678');
    assert.ok(LOGIN_RE.test(sanitizeLogin('🧛', '1')));
  });
  it('never exceeds 32 chars and always matches the login rule', () => {
    const s = sanitizeLogin('Ж'.repeat(50) + ' ' + 'x'.repeat(10), '123456789012345678');
    assert.ok(s.length <= 32);
    assert.ok(LOGIN_RE.test(s));
  });
  it('makes a name unique with a short suffix', () => {
    const taken = new Set(['bob', 'bob 2', 'bob 3']);
    assert.equal(uniqueLogin('Bob', (c) => taken.has(c.toLowerCase())), 'Bob 4');
    assert.equal(uniqueLogin('Zed', () => false), 'Zed');
    const long = 'x'.repeat(32);
    const u = uniqueLogin(long, (c) => c === long);
    assert.equal(u.length, 32);
    assert.ok(u.endsWith(' 2'));
  });
  it('validates the in-game nick', () => {
    assert.equal(cleanGameNick('  Vamp\n'), 'Vamp');
    assert.equal(cleanGameNick('a'), null);
    assert.equal(cleanGameNick('x'.repeat(41)), null);
    assert.equal(cleanGameNick('x'.repeat(40)), 'x'.repeat(40));
  });
});

describe('Discord registration over the internal API', () => {
  let api: Api;
  let admin = '';
  let db: InstanceType<typeof Database>;
  const H = { 'x-internal-token': 'i'.repeat(48) };
  const reg = (body: object, headers: Record<string, string> = H) => api.call('POST', '/internal/discord/register', { body, headers });
  const id = (n: number) => String(100000000000000000n + BigInt(n));

  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    db = new Database(api.dbPath);
  });
  after(async () => {
    db.close();
    await api.stop();
  });

  it('requires the internal token', async () => {
    const r = await reg({ discordId: id(1), displayName: 'X', gameNick: 'Nick' }, {});
    assert.equal(r.status, 403);
    const p = await api.call('GET', `/internal/discord/profile?discordId=${id(1)}`, {});
    assert.equal(p.status, 403);
  });

  it('creates a password-less player with the exact Discord name and the game nick', async () => {
    const r = await reg({ discordId: id(10), displayName: 'DarkLord ⚔️', avatarHash: 'abc123', gameNick: 'Vamp One' });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'created');
    assert.equal(r.body.username, 'DarkLord');
    assert.match(r.body.profileUrl, /^[^#]*\/profile$/);
    const u = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(id(10)) as any;
    assert.equal(u.role, 'player');
    assert.equal(u.status, 'active');
    assert.equal(u.no_password, 1);
    assert.equal(u.discord_name, 'DarkLord ⚔️');
    assert.equal(u.discord_avatar, 'abc123');
    const p = db.prepare('SELECT game_nick FROM user_player WHERE user_id = ?').get(u.id) as any;
    assert.equal(p.game_nick, 'Vamp One');
    const ev = db.prepare("SELECT kind FROM account_events WHERE user_id = ? AND kind = 'register_discord'").all(u.id);
    assert.equal(ev.length, 1);
  });

  it('cannot log in by password', async () => {
    for (const password of ['', 'password', 'Passw0rd!long']) {
      const r = await api.call('POST', '/api/auth/login', { body: { username: 'DarkLord', password } });
      assert.equal(r.status, 401);
    }
  });

  it('preserves case in discord_name, sanitises and keeps logins unique', async () => {
    const a = await reg({ discordId: id(20), displayName: 'MiXeD CaSe', gameNick: 'Mixed A' });
    assert.equal(a.body.username, 'MiXeD CaSe');
    const b = await reg({ discordId: id(21), displayName: 'mixed case', gameNick: 'Mixed B' });
    assert.equal(b.body.status, 'created');
    assert.notEqual(b.body.username.toLowerCase(), 'mixed case');
    assert.match(b.body.username, /^mixed case \d+$/);
    const c = await reg({ discordId: id(22), displayName: 'MIXED CASE', gameNick: 'Mixed C' });
    assert.notEqual(c.body.username.toLowerCase(), b.body.username.toLowerCase());
    const row = db.prepare('SELECT discord_name FROM users WHERE discord_id = ?').get(id(22)) as any;
    assert.equal(row.discord_name, 'MIXED CASE');
    for (const x of [a, b, c]) assert.ok(LOGIN_RE.test(x.body.username), x.body.username);
  });

  it('short and emoji-only names get a valid login', async () => {
    const a = await reg({ discordId: id(30), displayName: 'Jo', gameNick: 'Short Jo' });
    assert.equal(a.body.username, `Jo ${id(30).slice(-4)}`);
    const b = await reg({ discordId: id(31), displayName: '🧛🧛', gameNick: 'Emoji One' });
    assert.equal(b.body.status, 'created');
    assert.ok(LOGIN_RE.test(b.body.username), b.body.username);
    const row = db.prepare('SELECT discord_name FROM users WHERE discord_id = ?').get(id(31)) as any;
    assert.equal(row.discord_name, '🧛🧛');
  });

  it('answers exists and refreshes name, avatar and nick', async () => {
    const r = await reg({ discordId: id(10), displayName: 'DarkLord Renamed', avatarHash: 'newhash', gameNick: 'Vamp Two' });
    assert.equal(r.body.status, 'exists');
    assert.equal(r.body.username, 'DarkLord');
    const u = db.prepare('SELECT discord_name, discord_avatar FROM users WHERE discord_id = ?').get(id(10)) as any;
    assert.equal(u.discord_name, 'DarkLord Renamed');
    assert.equal(u.discord_avatar, 'newhash');
    const p = db.prepare('SELECT game_nick FROM user_player WHERE user_id = (SELECT id FROM users WHERE discord_id = ?)').get(id(10)) as any;
    assert.equal(p.game_nick, 'Vamp Two');
  });

  it('game nick is unique case-insensitively, but the same user may repeat it', async () => {
    const r = await reg({ discordId: id(40), displayName: 'Thief', gameNick: 'VAMP TWO' });
    assert.equal(r.body.status, 'conflict');
    assert.equal(db.prepare('SELECT 1 FROM users WHERE discord_id = ?').get(id(40)), undefined);
    const same = await reg({ discordId: id(10), displayName: 'DarkLord Renamed', gameNick: 'vamp two' });
    assert.equal(same.body.status, 'exists');
  });

  it('/nick: ok, notfound, conflict', async () => {
    const nick = (body: object) => api.call('POST', '/internal/discord/nick', { body, headers: H });
    assert.equal((await nick({ discordId: id(10), gameNick: 'Vamp Three' })).body.status, 'ok');
    assert.equal((await nick({ discordId: id(999), gameNick: 'Nobody' })).body.status, 'notfound');
    assert.equal((await nick({ discordId: id(10), gameNick: 'mixed a' })).body.status, 'conflict');
    assert.equal((await nick({ discordId: id(10), gameNick: 'x' })).status, 400);
  });

  it('/profile shape', async () => {
    const p = await api.call('GET', `/internal/discord/profile?discordId=${id(10)}`, { headers: H });
    assert.equal(p.status, 200);
    assert.equal(p.body.found, true);
    assert.equal(p.body.username, 'DarkLord');
    assert.equal(p.body.gameNick, 'Vamp Three');
    assert.equal(typeof p.body.achievements, 'number');
    assert.equal(typeof p.body.rank.name, 'string');
    assert.equal(p.body.rank.hours, 0);
    assert.match(p.body.profileUrl, /^[^#]*\/profile$/);
    const none = await api.call('GET', `/internal/discord/profile?discordId=${id(998)}`, { headers: H });
    assert.equal(none.body.found, false);
    assert.equal(none.body.rank, null);
  });

  it('shows up in the account journal', async () => {
    const u = db.prepare('SELECT id FROM users WHERE discord_id = ?').get(id(10)) as any;
    const kinds = (db.prepare('SELECT kind FROM account_events WHERE user_id = ?').all(u.id) as any[]).map((r) => r.kind);
    assert.ok(kinds.includes('register_discord'));
  });

  it('limits registration attempts per Discord id', async () => {
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await reg({ discordId: id(50), displayName: 'Spam', gameNick: 'Spam Nick' })).status;
    assert.equal(last, 429);
  });

  it('closed registration, rules and approval modes', async () => {
    const access = (body: object) => api.call('PUT', '/api/access', { token: admin, body });

    await access({ registration: false });
    const closed = await reg({ discordId: id(60), displayName: 'Closed', gameNick: 'Closed One' });
    assert.equal(closed.body.status, 'disabled');
    // an existing account is still updated
    assert.equal((await reg({ discordId: id(10), displayName: 'DarkLord', gameNick: 'Vamp Three' })).body.status, 'exists');

    await access({ registration: true, rules: 'Be nice.' });
    const rules = await reg({ discordId: id(61), displayName: 'Ruled', gameNick: 'Ruled One' });
    assert.equal(rules.body.status, 'rules');
    assert.equal(rules.body.rulesText, 'Be nice.');
    assert.equal(db.prepare('SELECT 1 FROM users WHERE discord_id = ?').get(id(61)), undefined);
    const agreed = await reg({ discordId: id(61), displayName: 'Ruled', gameNick: 'Ruled One', agree: true });
    assert.equal(agreed.body.status, 'created');

    await access({ rules: '', registrationMode: 'approval' });
    const pending = await reg({ discordId: id(62), displayName: 'Waiting', gameNick: 'Waiting One' });
    assert.equal(pending.body.status, 'pending');
    const u = db.prepare('SELECT status, no_password FROM users WHERE discord_id = ?').get(id(62)) as any;
    assert.equal(u.status, 'pending');
    assert.equal(u.no_password, 1);
    await access({ registrationMode: 'open' });
  });
});
