/** Password policy, idle sessions of staff, the __Host- session cookie and answers that do not reveal which logins exist. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { passwordProblem } from '../src/security/passwordPolicy.ts';
import { codeAt } from '../src/security/totp.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('password policy', () => {
  it('a short password, a common one, the name and a run are refused', () => {
    assert.equal(passwordProblem('abc', { role: 'player' }), 'short');
    assert.equal(passwordProblem('password123', { role: 'player' }), 'common');
    assert.equal(passwordProblem('Qwerty123', { role: 'player' }), 'common');
    assert.equal(passwordProblem('Alexander', { username: 'alexander', role: 'player' }), 'same_as_name');
    assert.equal(passwordProblem('12345678', { role: 'player' }), 'common');
    assert.equal(passwordProblem('87654321', { role: 'player' }), 'run');
    assert.equal(passwordProblem('zzzzzzzz', { role: 'player' }), 'run');
    assert.equal(passwordProblem('kkkkkkkk', { role: 'player' }), 'run');
  });
  it('staff need 12 characters, a player 8', () => {
    assert.equal(passwordProblem('Tr0ub4dor&', { role: 'admin' }), 'short_admin');
    assert.equal(passwordProblem('Tr0ub4dor&3x!', { role: 'admin' }), null);
    assert.equal(passwordProblem('Tr0ub4dor&', { role: 'player' }), null);
    assert.equal(passwordProblem('Tr0ub4dor&', { role: 'moderator' }), 'short_admin');
  });
});

describe('api: accounts', () => {
  let api: Api;
  let admin = '';
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
  });
  after(async () => { await api.stop(); });

  const register = (username: string, password: string) => api.call('POST', '/api/auth/register', { body: { username, password, acceptRules: true } });

  it('registration refuses weak passwords and accepts a good one', async () => {
    assert.equal((await register('weak_one', 'password123')).status, 400);
    assert.equal((await register('weak_two', '12345678')).status, 400);
    const same = await register('Samename1', 'samename1');
    assert.equal(same.status, 400);
    assert.equal(same.body.code, 'password_same_as_name');
    assert.equal((await register('strong_one', 'Tr0ub4dor&3x')).status, 201);
  });

  it('an administrator cannot set a password shorter than 12 characters, a player may use 8', async () => {
    const r = await api.call('POST', '/api/auth/password', { token: admin, body: { current: 'Passw0rd!long', next: 'Short#Pw9' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'password_short_staff');
    const ok = await api.call('POST', '/api/auth/password', { token: admin, body: { current: 'Passw0rd!long', next: 'Another#Pass42x' } });
    assert.equal(ok.status, 200);
    const p = (await register('plain_player', 'Tr0ub4dor&3x')).body.token as string;
    assert.equal((await api.call('POST', '/api/auth/password', { token: p, body: { current: 'Tr0ub4dor&3x', next: 'Eight#Pw9' } })).status, 200);
  });

  it('a staff session that has been idle for too long ends, a player session does not', async () => {
    const login = await api.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'Another#Pass42x' } });
    const staffToken = login.body.token as string;
    const player = await api.call('POST', '/api/auth/login', { body: { username: 'strong_one', password: 'Tr0ub4dor&3x' } });
    const playerToken = player.body.token as string;
    assert.equal((await api.call('GET', '/api/me', { token: staffToken })).status, 200);
    const db = new Database(api.dbPath);
    db.prepare('UPDATE sessions SET last_seen = ?').run(Date.now() - 13 * 3600_000);
    db.close();
    assert.equal((await api.call('GET', '/api/me', { token: staffToken })).status, 401, 'staff idle for 13 h');
    assert.equal((await api.call('GET', '/api/me', { token: playerToken })).status, 200, 'a player stays');
  });

  it('the idle limit can be changed or switched off', async () => {
    const login = await api.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'Another#Pass42x' } });
    const token = login.body.token as string;
    const db = new Database(api.dbPath);
    db.prepare("INSERT INTO settings (key, value) VALUES ('staff_idle_hours', '0') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    db.prepare('UPDATE sessions SET last_seen = ?').run(Date.now() - 100 * 3600_000);
    db.close();
    assert.equal((await api.call('GET', '/api/me', { token })).status, 200);
  });

  it('over https the session cookie has the __Host- prefix and Secure, over http the plain name', async () => {
    const body = JSON.stringify({ username: 'strong_one', password: 'Tr0ub4dor&3x' });
    const headers = { 'content-type': 'application/json', 'x-coregsm': '1' };
    const secure = await fetch(`${api.base}/api/auth/login`, { method: 'POST', headers: { ...headers, 'x-forwarded-proto': 'https' }, body });
    const c1 = secure.headers.getSetCookie().find((c) => c.includes('coregsm_session=') && !c.includes('Expires=Thu, 01 Jan 1970')) ?? '';
    assert.match(c1, /^__Host-coregsm_session=/);
    assert.match(c1, /Secure/);
    assert.match(c1, /Path=\//);
    assert.doesNotMatch(c1, /Domain=/);
    const plain = await fetch(`${api.base}/api/auth/login`, { method: 'POST', headers, body });
    const c2 = plain.headers.getSetCookie().find((c) => c.includes('coregsm_session=')) ?? '';
    assert.match(c2, /^coregsm_session=/);
    assert.doesNotMatch(c2, /Secure/);
  });

  it('the prefixed cookie signs in, and so does the plain cookie of an older sign-in', async () => {
    const token = (await api.call('POST', '/api/auth/login', { body: { username: 'strong_one', password: 'Tr0ub4dor&3x' } })).body.token as string;
    for (const name of ['__Host-coregsm_session', 'coregsm_session']) {
      const r = await fetch(`${api.base}/api/me`, { headers: { cookie: `${name}=${token}` } });
      assert.equal(r.status, 200, name);
    }
    // a state-changing request with a cookie and no header is still refused
    const post = await fetch(`${api.base}/api/auth/password`, { method: 'POST', headers: { cookie: `__Host-coregsm_session=${token}`, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(post.status, 403);
  });

  it('forgotten password: the same answer for a login that exists and one that does not', async () => {
    const a = await api.call('POST', '/api/auth/forgot', { body: { login: 'strong_one' } });
    const b = await api.call('POST', '/api/auth/forgot', { body: { login: 'nobody_here' } });
    assert.equal(a.status, b.status);
    assert.deepEqual(a.body, b.body);
  });

  it('login: a wrong password and an unknown login look the same', async () => {
    const a = await api.call('POST', '/api/auth/login', { body: { username: 'strong_one', password: 'wrong-password-1' } });
    const b = await api.call('POST', '/api/auth/login', { body: { username: 'nobody_here', password: 'wrong-password-1' } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error, b.body.error);
  });
});

describe('api: protected actions need the password again', () => {
  let api: Api;
  let admin = '';
  let other = '';
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    other = (await api.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'Passw0rd!long' } })).body.token as string;
  });
  after(async () => { await api.stop(); });

  const addServer = () => {
    const db = new Database(api.dbPath);
    const id = Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('S', 'rust', '127.0.0.1', 28015, ?)").run(Date.now()).lastInsertRowid);
    db.close();
    return id;
  };

  it('deleting a server is refused until the session is confirmed, then it works for ten minutes', async () => {
    const id = addServer();
    const refused = await api.call('DELETE', `/api/servers/${id}`, { token: admin, reauth: false });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'reauth_required');
    const status = await api.call('GET', '/api/auth/reauth', { token: admin });
    assert.deepEqual({ active: status.body.active, method: status.body.method, twoFactor: status.body.twoFactor }, { active: false, method: 'password', twoFactor: false });
    assert.equal((await api.call('POST', '/api/auth/reauth', { token: admin, body: { password: 'wrong-password' } })).status, 403);
    const ok = await api.call('POST', '/api/auth/reauth', { token: admin, body: { password: 'Passw0rd!long' } });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.until > Date.now() && ok.body.until <= Date.now() + 10 * 60_000 + 1000);
    assert.equal((await api.call('GET', '/api/auth/reauth', { token: admin })).body.active, true);
    assert.equal((await api.call('DELETE', `/api/servers/${id}`, { token: admin, reauth: false })).status, 200);
  });

  it('the confirmation belongs to one session and ends after ten minutes', async () => {
    const id = addServer();
    // `admin` was confirmed above; the other session of the same account was not
    assert.equal((await api.call('DELETE', `/api/servers/${id}`, { token: other, reauth: false })).status, 403);
    const db = new Database(api.dbPath);
    db.prepare('UPDATE sessions SET sudo_until = ?').run(Date.now() - 1000);
    db.close();
    assert.equal((await api.call('DELETE', `/api/servers/${id}`, { token: admin, reauth: false })).status, 403);
  });

  it('the bot token, the mail server, API keys, backups and roles are protected too', async () => {
    const no = { token: other, reauth: false } as const;
    assert.equal((await api.call('PUT', '/api/settings', { ...no, body: { discordToken: 'x'.repeat(30) } })).status, 403);
    assert.equal((await api.call('PUT', '/api/settings/smtp', { ...no, body: { host: 'smtp.example.com' } })).status, 403);
    assert.equal((await api.call('POST', '/api/integrations/keys', { ...no, body: { name: 'k' } })).status, 403);
    assert.equal((await api.call('GET', '/api/backup', no)).status, 403);
    assert.equal((await api.call('GET', '/api/backups/some.tar.gz', no)).status, 403);
    assert.equal((await api.call('POST', '/api/backups/some.tar.gz/restore', { ...no, body: {} })).status, 403);
    assert.equal((await api.call('POST', '/api/backup/restore', { ...no, raw: Buffer.from('x') })).status, 403);
    // a change that is not a secret or a role stays open
    assert.equal((await api.call('PUT', '/api/settings', { ...no, body: { botCardStyle: 'strip' } })).status, 200);
  });

  it('with the second factor on, the code is needed as well', async () => {
    const setup = await api.call('POST', '/api/auth/2fa/setup', { token: other });
    const secret = setup.body.secret as string;
    const step = Math.floor(Date.now() / 30_000);
    assert.equal((await api.call('POST', '/api/auth/2fa/enable', { token: other, body: { code: codeAt(secret, step) } })).status, 200);
    assert.equal((await api.call('GET', '/api/auth/reauth', { token: other })).body.twoFactor, true);
    const noCode = await api.call('POST', '/api/auth/reauth', { token: other, body: { password: 'Passw0rd!long' } });
    assert.equal(noCode.status, 400);
    assert.equal(noCode.body.twoFactor, true);
    assert.equal((await api.call('POST', '/api/auth/reauth', { token: other, body: { password: 'Passw0rd!long', code: '000000' } })).status, 401);
    // the code of the next period (the one of this period was used to turn it on and cannot be used twice)
    const ok = await api.call('POST', '/api/auth/reauth', { token: other, body: { password: 'Passw0rd!long', code: codeAt(secret, step + 1) } });
    assert.equal(ok.status, 200);
  });

  it('an account made through Discord has no password: it confirms with its name', async () => {
    const db = new Database(api.dbPath);
    const id = Number(db.prepare("INSERT INTO users (username, password_hash, role, created_at, no_password) VALUES ('dscd', 'x', 'admin', ?, 1)").run(Date.now()).lastInsertRowid);
    const sid = 'd'.repeat(24);
    db.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen, ip, ua) VALUES (?, ?, ?, ?, ?, ?)').run(sid, id, Date.now(), Date.now(), '', '');
    db.close();
    const token = jwt.sign({ username: 'dscd', sid }, 'j'.repeat(48), { subject: String(id), expiresIn: '1h', algorithm: 'HS256' });
    assert.equal((await api.call('GET', '/api/auth/reauth', { token })).body.method, 'name');
    assert.equal((await api.call('POST', '/api/auth/reauth', { token, body: { confirm: 'someone else' } })).status, 403);
    assert.equal((await api.call('POST', '/api/auth/reauth', { token, body: { confirm: 'DSCD' } })).status, 200);
  });
});

describe('api: backups are encrypted by default on a fresh panel', () => {
  let api: Api;
  let admin = '';
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
  });
  after(async () => { await api.stop(); });

  it('the first backup is encrypted with a phrase the panel made, shown once', async () => {
    assert.equal((await api.call('GET', '/api/backups', { token: admin })).body.encrypted, false);
    const made = await api.call('POST', '/api/backups/run', { token: admin });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.match(made.body.name, /\.tar\.gz\.enc$/);
    const list = await api.call('GET', '/api/backups', { token: admin });
    assert.equal(list.body.encrypted, true);
    assert.equal(list.body.passphraseUnseen, true);
    const phrase = await api.call('GET', '/api/backups-passphrase', { token: admin });
    assert.equal(phrase.status, 200);
    assert.ok(String(phrase.body.phrase).length >= 20);
    // the settings never hand the phrase out
    assert.equal(JSON.stringify(list.body).includes(phrase.body.phrase), false);
    assert.equal((await api.call('POST', '/api/backups-passphrase/ack', { token: admin })).status, 200);
    assert.equal((await api.call('GET', '/api/backups/' + made.body.name, { token: admin })).status, 200);
    assert.equal((await api.call('GET', '/api/backups-passphrase', { token: admin })).status, 404);
    assert.equal((await api.call('GET', '/api/backups', { token: admin })).body.passphraseUnseen, false);
  });

  it('the phrase needs the password again to be shown', async () => {
    const fresh = await startBackend();
    try {
      const t = await setupAdmin(fresh);
      await fresh.call('POST', '/api/backups/run', { token: t });
      const refused = await fresh.call('GET', '/api/backups-passphrase', { token: t, reauth: false });
      assert.equal(refused.status, 403);
      assert.equal(refused.body.code, 'reauth_required');
    } finally {
      await fresh.stop();
    }
  });

  it('a panel whose owner chose none keeps writing plain copies', async () => {
    const other = await startBackend();
    try {
      const t = await setupAdmin(other);
      assert.equal((await other.call('PUT', '/api/backups/settings', { token: t, body: { passphrase: '' } })).status, 200);
      const made = await other.call('POST', '/api/backups/run', { token: t });
      assert.doesNotMatch(made.body.name, /\.enc$/);
    } finally {
      await other.stop();
    }
  });
});
