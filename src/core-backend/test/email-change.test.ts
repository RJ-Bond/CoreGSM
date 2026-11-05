/** A verified address is changed through the link sent to the OLD address (the letter itself needs SMTP, so the link is made here by hand). */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { ADMIN, setupAdmin, startBackend, type Api } from './harness.ts';

describe('api: confirming a change of e-mail from the old address', () => {
  let api: Api;
  let token = '';
  const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
  });
  after(async () => { await api.stop(); });

  it('the link changes the address once, and a bad or expired link does nothing', async () => {
    assert.equal((await api.call('PUT', '/api/me/email', { token, body: { email: 'old@example.com', current: ADMIN.password } })).status, 200);
    const db = new Database(api.dbPath);
    const uid = (db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN.username) as { id: number }).id;
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(uid);
    const ins = db.prepare('INSERT INTO email_changes (token_hash, user_id, new_email, expires_at) VALUES (?, ?, ?, ?)');
    ins.run(hash('expired-token-123456'), uid, 'late@example.com', Date.now() - 1000);
    ins.run(hash('good-token-1234567890'), uid, 'new@example.com', Date.now() + 60_000);
    assert.equal((await api.call('POST', '/api/auth/verify-email', { body: { token: 'expired-token-123456' } })).status, 400);
    assert.equal((await api.call('POST', '/api/auth/verify-email', { body: { token: 'wrong-token-1234567890' } })).status, 400);
    const ok = await api.call('POST', '/api/auth/verify-email', { body: { token: 'good-token-1234567890' } });
    assert.equal(ok.status, 200);
    assert.equal((ok.body as { email: string }).email, 'new@example.com');
    const row = db.prepare('SELECT email, email_verified FROM users WHERE id = ?').get(uid) as { email: string; email_verified: number };
    assert.deepEqual(row, { email: 'new@example.com', email_verified: 0 });
    // the link works once
    assert.equal((await api.call('POST', '/api/auth/verify-email', { body: { token: 'good-token-1234567890' } })).status, 400);
    db.close();
  });
});
