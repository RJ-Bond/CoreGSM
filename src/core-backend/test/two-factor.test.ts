import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { base32Decode, base32Encode, codeAt, newRecoveryCodes, useRecoveryCode, verifyCode } from '../src/totp.ts';
import { ADMIN, setupAdmin, startBackend, type Api } from './harness.ts';

describe('totp primitives', () => {
  it('matches the RFC 6238 test vector (SHA-1, 8 digits truncated to 6)', () => {
    // secret "12345678901234567890", T = 59 s -> step 1 -> 94287082 -> 287082
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    assert.equal(codeAt(secret, 1), '287082');
    assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  });

  it('accepts one step of drift and never the same step twice', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = 59_000;
    const step = verifyCode(secret, '287082', now);
    assert.equal(step, 1);
    assert.equal(verifyCode(secret, '287082', now, 1), null);
    assert.equal(verifyCode(secret, '287082', now + 30_000), 1);
    assert.equal(verifyCode(secret, '287082', now + 90_000), null);
    assert.equal(verifyCode(secret, 'abcdef', now), null);
  });

  it('recovery codes work once', () => {
    const { plain, hashes } = newRecoveryCodes();
    assert.equal(plain.length, 8);
    const left = useRecoveryCode(hashes, plain[0]);
    assert.equal(left?.length, 7);
    assert.equal(useRecoveryCode(left!, plain[0]), null);
    assert.equal(useRecoveryCode(hashes, 'zzzzz-zzzzz'), null);
  });
});

describe('two-factor sign-in', () => {
  let api: Api;
  let token = '';
  let secret = '';
  let recovery: string[] = [];
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('is off by default and asks nothing at login', async () => {
    assert.equal((await api.call('GET', '/api/auth/2fa', { token })).body.enabled, false);
    assert.ok((await api.call('POST', '/api/auth/login', { body: ADMIN })).body.token);
  });

  it('set-up needs a valid code before it turns on', async () => {
    const s = await api.call('POST', '/api/auth/2fa/setup', { token });
    assert.equal(s.status, 200);
    secret = s.body.secret;
    assert.match(s.body.uri, /^otpauth:\/\/totp\//);
    assert.equal((await api.call('POST', '/api/auth/2fa/enable', { token, body: { code: '000000' } })).status, 400);
    const step = Math.floor(Date.now() / 30_000);
    const ok = await api.call('POST', '/api/auth/2fa/enable', { token, body: { code: codeAt(secret, step) } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    recovery = ok.body.recoveryCodes;
    assert.equal(recovery.length, 8);
    assert.equal((await api.call('GET', '/api/auth/2fa', { token })).body.enabled, true);
  });

  it('login now asks for a code, rejects a wrong one and accepts a fresh one', async () => {
    const first = await api.call('POST', '/api/auth/login', { body: ADMIN });
    assert.equal(first.status, 200);
    assert.equal(first.body.twoFactor, true);
    assert.equal(first.body.token, undefined);
    const bad = await api.call('POST', '/api/auth/login', { body: { ...ADMIN, code: '123456' } });
    assert.equal(bad.status, 401);
    // the step used while enabling is spent; the next one is fine
    const next = codeAt(secret, Math.floor(Date.now() / 30_000) + 1);
    const ok = await api.call('POST', '/api/auth/login', { body: { ...ADMIN, code: next } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.token);
    // the same code cannot be replayed
    assert.equal((await api.call('POST', '/api/auth/login', { body: { ...ADMIN, code: next } })).status, 401);
  });

  it('a recovery code signs in once', async () => {
    const r = await api.call('POST', '/api/auth/login', { body: { ...ADMIN, code: recovery[0] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await api.call('POST', '/api/auth/login', { body: { ...ADMIN, code: recovery[0] } })).status, 401);
    assert.equal((await api.call('GET', '/api/auth/2fa', { token })).body.recoveryLeft, 7);
  });

  it('turning it off needs the password and a code', async () => {
    assert.equal((await api.call('POST', '/api/auth/2fa/disable', { token, body: { password: 'wrong-password', code: recovery[1] } })).status, 403);
    assert.equal((await api.call('POST', '/api/auth/2fa/disable', { token, body: { password: ADMIN.password, code: '000000' } })).status, 400);
    assert.equal((await api.call('POST', '/api/auth/2fa/disable', { token, body: { password: ADMIN.password, code: recovery[1] } })).status, 200);
    assert.ok((await api.call('POST', '/api/auth/login', { body: ADMIN })).body.token);
  });
});
