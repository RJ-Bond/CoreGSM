/** The sign-in puzzle: asked after a few wrong passwords, solved by the browser, works once. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { ADMIN, setupAdmin, startBackend, type Api } from './harness.ts';

const leadingZeroBits = (buf: Buffer): number => {
  let n = 0;
  for (const b of buf) {
    if (b === 0) { n += 8; continue; }
    n += Math.clz32(b) - 24;
    break;
  }
  return n;
};
const solve = (challenge: string, bits: number): string => {
  for (let n = 0; ; n++) if (leadingZeroBits(crypto.createHash('sha256').update(`${challenge}:${n}`).digest()) >= bits) return String(n);
};

describe('api: sign-in puzzle', () => {
  let api: Api;
  before(async () => {
    api = await startBackend({ LOGIN_CAPTCHA_AFTER: '3' });
    await setupAdmin(api);
  });
  after(async () => { await api.stop(); });
  const login = (password: string, pow?: unknown) => api.call('POST', '/api/auth/login', { body: { username: ADMIN.username, password, ...(pow ? { pow } : {}) } });

  it('three wrong passwords later the puzzle is required, a solved one lets the right password in once', async () => {
    for (let i = 0; i < 2; i++) assert.equal((await login('wrong-password-1')).status, 401);
    const third = await login('wrong-password-1');
    assert.equal(third.status, 401);
    assert.equal((third.body as { captcha?: boolean }).captcha, true);
    // no puzzle: refused before the password is even looked at
    assert.equal((await login(ADMIN.password)).status, 428);
    const ch = (await api.call('GET', '/api/auth/challenge')).body as { challenge: string; bits: number };
    const pow = { challenge: ch.challenge, nonce: solve(ch.challenge, ch.bits) };
    // a wrong nonce and a forged challenge fail
    assert.equal((await login(ADMIN.password, { challenge: ch.challenge, nonce: 'x' })).status, 428);
    assert.equal((await login(ADMIN.password, { challenge: `${ch.challenge}a`, nonce: pow.nonce })).status, 428);
    const ok = await login(ADMIN.password, pow);
    assert.equal(ok.status, 200);
    // a success clears the counter: no puzzle any more, and the old one cannot be replayed
    assert.equal((await login(ADMIN.password)).status, 200);
  });
});
