import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { ADMIN, setupAdmin, startBackend, type Api } from './harness.ts';

const INTERNAL = { 'x-internal-token': 'i'.repeat(48) };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-sec-'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mails(file: string, want: number, timeout = 5000): Promise<{ to: string; subject: string; text: string }[]> {
  const end = Date.now() + timeout;
  for (;;) {
    const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    if (rows.length >= want || Date.now() > end) return rows;
    await sleep(100);
  }
}

/** the newest letter whose text or subject matches */
async function findMail(file: string, re: RegExp, timeout = 5000) {
  const end = Date.now() + timeout;
  for (;;) {
    const hit = (await mails(file, 0, 0)).filter((l) => re.test(l.text) || re.test(l.subject)).pop();
    if (hit || Date.now() > end) return hit;
    await sleep(100);
  }
}

const tokenIn = (text: string, kind: string) => new RegExp(`#/${kind}/([A-Za-z0-9_-]+)`).exec(text)?.[1] ?? '';

describe('secrets at rest', () => {
  it('round-trips and rejects a wrong key', async () => {
    process.env.JWT_SECRET = 'a'.repeat(48);
    delete process.env.SECRETS_KEY;
    const s = await import('../src/secrets.ts');
    const enc = s.encryptSecret('hunter2-token');
    assert.ok(enc.startsWith('enc:v1:'));
    assert.notEqual(enc, s.encryptSecret('hunter2-token'), 'random IV');
    assert.equal(s.decryptSecret(enc), 'hunter2-token');
    assert.equal(s.decryptSecret('legacy-plaintext'), 'legacy-plaintext');
    assert.ok(s.isSecretKey('discord_token') && s.isSecretKey('smtp_password') && s.isSecretKey('x_secret') && s.isSecretKey('y_token'));
    assert.ok(!s.isSecretKey('brand_name'));
    process.env.SECRETS_KEY = 'b'.repeat(40);
    assert.throws(() => s.decryptSecret(enc));
    assert.equal(s.canDecrypt(enc), false);
    delete process.env.SECRETS_KEY;
    assert.equal(s.decryptSecret(enc), 'hunter2-token');
  });

  describe('migration and the bot endpoint', () => {
    let api: Api;
    let dbFile = '';
    let admin = '';
    before(async () => {
      const dir = tmp();
      dbFile = path.join(dir, 'coregsm.db');
      const old = new Database(dbFile);
      old.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      old.prepare('INSERT INTO settings VALUES (?, ?)').run('discord_token', 'MTIzNDU2Nzg5MDEyMzQ1Njc4.plain.token');
      old.prepare('INSERT INTO settings VALUES (?, ?)').run('brand_name', 'My Panel');
      old.close();
      api = await startBackend({ DB_PATH: dbFile, DATA_DIR: dir });
      admin = await setupAdmin(api);
    });
    after(async () => { await api.stop(); });

    it('encrypts plaintext settings at boot and keeps the bot working', async () => {
      const raw = new Database(dbFile, { readonly: true });
      const rows = Object.fromEntries((raw.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
      raw.close();
      assert.ok(rows.discord_token.startsWith('enc:v1:'));
      assert.equal(rows.brand_name, 'My Panel');
      const cfg = await api.call('GET', '/internal/config', { headers: INTERNAL });
      assert.equal(cfg.body.discordToken, 'MTIzNDU2Nzg5MDEyMzQ1Njc4.plain.token');
    });

    it('stores new secrets encrypted and never returns the SMTP password', async () => {
      const put = await api.call('PUT', '/api/settings/smtp', { token: admin, body: { host: 'smtp.example.com', port: 587, secure: false, user: 'u', password: 's3cret-pass', from: 'Panel <no-reply@example.com>' } });
      assert.equal(put.status, 200);
      assert.equal(put.body.passwordSet, true);
      assert.equal(put.body.password, undefined);
      const get = await api.call('GET', '/api/settings/smtp', { token: admin });
      assert.equal(JSON.stringify(get.body).includes('s3cret-pass'), false);
      const raw = new Database(dbFile, { readonly: true });
      const v = (raw.prepare("SELECT value FROM settings WHERE key = 'smtp_password'").get() as { value: string }).value;
      raw.close();
      assert.ok(v.startsWith('enc:v1:'));
      assert.equal((await api.call('GET', '/api/settings/smtp')).status, 401);
    });
  });
});

describe('cookie session, CSRF guard, headers', () => {
  let api: Api;
  let bearer = '';
  before(async () => { api = await startBackend(); bearer = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  const login = (extra: Record<string, string> = {}) =>
    fetch(`${api.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(ADMIN) });

  it('sets an HttpOnly Lax cookie, Secure behind https', async () => {
    const plain = await login();
    const c1 = plain.headers.getSetCookie().find((c) => c.startsWith('coregsm_session='))!;
    assert.ok(c1, 'cookie set');
    assert.match(c1, /HttpOnly/i);
    assert.match(c1, /SameSite=Lax/i);
    assert.match(c1, /Path=\//);
    assert.doesNotMatch(c1, /Secure/i);
    const tls = await login({ 'x-forwarded-proto': 'https' });
    const c2 = tls.headers.getSetCookie().find((c) => c.startsWith('coregsm_session='))!;
    assert.match(c2, /Secure/i);
    assert.ok(tls.headers.get('strict-transport-security'));
    assert.equal(plain.headers.get('strict-transport-security'), null);
  });

  it('accepts the cookie and requires X-CoreGSM for writes', async () => {
    const r = await login();
    const cookie = r.headers.getSetCookie().find((c) => c.startsWith('coregsm_session='))!.split(';')[0];
    const me = await api.call('GET', '/api/me', { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.equal(me.body.username, 'admin');
    const noHeader = await api.call('PUT', '/api/me/email', { headers: { cookie }, body: { email: 'csrf@example.com', current: ADMIN.password } });
    assert.equal(noHeader.status, 403);
    const withHeader = await api.call('PUT', '/api/me/email', { headers: { cookie, 'x-coregsm': '1' }, body: { email: 'csrf@example.com', current: ADMIN.password } });
    assert.equal(withHeader.status, 200);
    // Bearer clients are not affected
    const viaBearer = await api.call('PUT', '/api/me/email', { token: bearer, body: { email: 'csrf2@example.com', current: ADMIN.password } });
    assert.equal(viaBearer.status, 200);
  });

  it('turns a Bearer token into a cookie and logout clears it', async () => {
    const r = await fetch(`${api.base}/api/auth/session`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'x-coregsm': '1' } });
    assert.equal(r.status, 200);
    const cookie = r.headers.getSetCookie().find((c) => c.startsWith('coregsm_session='))!.split(';')[0];
    assert.equal((await api.call('GET', '/api/me', { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${api.base}/api/auth/session`, { method: 'POST' })).status, 401);
    const out = await fetch(`${api.base}/api/sessions/current`, { method: 'DELETE', headers: { cookie, 'x-coregsm': '1' } });
    assert.equal(out.status, 200);
    assert.match(out.headers.getSetCookie().join(';'), /coregsm_session=;/);
    assert.equal((await api.call('GET', '/api/me', { headers: { cookie } })).status, 401);
  });

  it('sends security headers on API answers', async () => {
    const r = await fetch(`${api.base}/api/health`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.ok(r.headers.get('permissions-policy'));
    assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  });
});

describe('lockout', () => {
  let api: Api;
  before(async () => { api = await startBackend(); await setupAdmin(api); });
  after(async () => { await api.stop(); });

  const attempt = (username: string, ip: string, password = 'wrong-password') =>
    fetch(`${api.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ username, password }) });

  it('locks one account after repeated failures with Retry-After', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await attempt('admin', '10.1.0.1')).status, 401);
    const locked = await attempt('admin', '10.1.0.1', ADMIN.password);
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
  });

  it('locks an address that fails across several logins', async () => {
    const ip = '10.2.0.1';
    for (const name of ['alice', 'bob', 'carol', 'dave', 'erin', 'frank']) assert.equal((await attempt(name, ip)).status, 401);
    const locked = await attempt('admin', ip, ADMIN.password);
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
    // another address is not affected
    assert.equal((await attempt('admin', '10.2.0.2', ADMIN.password)).status, 200);
  });
});

describe('e-mail: verification, password reset, new device', () => {
  let api: Api;
  let admin = '';
  let mailFile = '';
  before(async () => {
    mailFile = path.join(tmp(), 'mail.jsonl');
    api = await startBackend({ MAIL_DEBUG_FILE: mailFile, PUBLIC_URL: 'https://panel.example.com' });
    admin = await setupAdmin(api);
  });
  after(async () => { await api.stop(); });

  const login = (password: string, headers: Record<string, string> = {}) =>
    api.call('POST', '/api/auth/login', { body: { username: 'admin', password }, headers });

  it('sends a test letter', async () => {
    const r = await api.call('POST', '/api/settings/smtp/test', { token: admin, body: { to: 'me@example.com' } });
    assert.equal(r.status, 200);
    assert.equal((await mails(mailFile, 1)).length, 1);
    assert.equal((await api.call('POST', '/api/settings/smtp/test', { body: { to: 'me@example.com' } })).status, 401);
  });

  it('verifies the address by a link', async () => {
    assert.equal((await api.call('PUT', '/api/me/email', { token: admin, body: { email: 'admin@example.com', current: ADMIN.password } })).status, 200);
    assert.equal((await api.call('GET', '/api/me', { token: admin })).body.emailVerified, false);
    const req = await api.call('POST', '/api/me/email/verify-request', { token: admin });
    assert.equal(req.status, 200);
    const last = (await findMail(mailFile, /#\/verify\//))!;
    assert.equal(last.to, 'admin@example.com');
    assert.match(last.text, /https:\/\/panel\.example\.com\/#\/verify\//);
    const token = tokenIn(last.text, 'verify');
    assert.ok(token);
    assert.equal((await api.call('POST', '/api/auth/verify-email', { body: { token: 'x'.repeat(30) } })).status, 400);
    assert.equal((await api.call('POST', '/api/auth/verify-email', { body: { token } })).status, 200);
    assert.equal((await api.call('GET', '/api/me', { token: admin })).body.emailVerified, true);
    assert.equal((await api.call('POST', '/api/auth/verify-email', { body: { token } })).status, 400, 'single use');
  });

  it('notices a sign-in from a new device', async () => {
    const chrome = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36', 'x-forwarded-for': '203.0.113.5' };
    const firefox = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0', 'x-forwarded-for': '198.51.100.7' };
    const a = await login(ADMIN.password, chrome);
    assert.equal(a.status, 200);
    // the earlier sign-ins (setup, other tests) recorded another device, so this one is new
    const first = (await api.call('GET', '/api/me', { token: a.body.token })).body.newDevice;
    assert.match(first.label, /Chrome/);
    const same = await login(ADMIN.password, { ...chrome, 'x-forwarded-for': '203.0.113.99' });
    assert.equal((await api.call('GET', '/api/me', { token: same.body.token })).body.newDevice.ts, first.ts, 'same /24 and browser: no new event');
    const b = await login(ADMIN.password, firefox);
    const me = await api.call('GET', '/api/me', { token: b.body.token });
    assert.ok(me.body.newDevice?.ts > 0);
    assert.match(me.body.newDevice.label, /Firefox/);
    assert.ok(await findMail(mailFile, /Новый вход/));
  });

  it('resets the password once and ends all sessions', async () => {
    const oldSession = (await login(ADMIN.password, { 'x-forwarded-for': '203.0.113.5' })).body.token as string;
    const unknown = await api.call('POST', '/api/auth/forgot', { body: { login: 'nobody-here' } });
    const known = await api.call('POST', '/api/auth/forgot', { body: { login: 'admin' } });
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.body, known.body, 'same answer for known and unknown accounts');
    const reset = (await findMail(mailFile, /#\/reset\//))!;
    assert.match(reset.text, /#\/reset\//);
    const token = tokenIn(reset.text, 'reset');
    assert.equal((await api.call('POST', '/api/auth/reset', { body: { token, password: 'short' } })).status, 400);
    const ok = await api.call('POST', '/api/auth/reset', { body: { token, password: 'Brand-new-pass1' } });
    assert.equal(ok.status, 200);
    assert.equal((await api.call('POST', '/api/auth/reset', { body: { token, password: 'Another-pass-2' } })).status, 400, 'single use');
    assert.equal((await api.call('GET', '/api/me', { token: oldSession })).status, 401);
    assert.equal((await login(ADMIN.password)).status, 401);
    assert.equal((await login('Brand-new-pass1')).status, 200);
  });
});
