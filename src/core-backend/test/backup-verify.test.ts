/** The weekly restore check: a stored backup is opened like a restore would, and a broken one is reported. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-bkv-'));
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ??= 'i'.repeat(48);
const { db, setSetting } = await import('../src/db.ts');
const { BACKUP_DIR, createStoredBackup, lastVerify, runVerifyIfDue, verifyBackup, verifyDue } = await import('../src/admin/backup.ts');

const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
db.prepare(`INSERT INTO users (username, password_hash${cols.includes('role') ? ', role' : ''}${cols.includes('status') ? ', status' : ''}) VALUES ('root', 'x'${cols.includes('role') ? ", 'admin'" : ''}${cols.includes('status') ? ", 'active'" : ''})`).run();

const NOW = 1_900_000_000_000;

describe('verifyDue', () => {
  const newest = { name: 'a', createdAt: NOW - 3600_000 };
  it('nothing to check without a copy', () => assert.equal(verifyDue(null, null, NOW), false));
  it('a copy that is not yet five minutes old waits', () => assert.equal(verifyDue({ name: 'a', createdAt: NOW - 60_000 }, null, NOW), false));
  it('never checked: due', () => assert.equal(verifyDue(newest, null, NOW), true));
  it('checked within a week: not due; older: due', () => {
    assert.equal(verifyDue(newest, { at: NOW - 3 * 86400_000, name: 'a' }, NOW), false);
    assert.equal(verifyDue(newest, { at: NOW - 7 * 86400_000, name: 'a' }, NOW), true);
  });
});

describe('verifyBackup', () => {
  it('a good copy opens, and the result is remembered', async () => {
    const it1 = await createStoredBackup('manual');
    const r = await verifyBackup(it1.name);
    assert.equal(r.ok, true, r.message);
    assert.equal(r.users, 1);
    assert.equal(r.message, '');
    assert.deepEqual(lastVerify(), r);
    // nothing is left behind in the data folder
    assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.startsWith('.verify-stage-') || n.startsWith('.restore-dec-')), []);
  });

  it('a damaged copy is reported, not thrown', async () => {
    const name = 'coregsm-20200101-000000-manual.tar.gz';
    fs.writeFileSync(path.join(BACKUP_DIR, name), Buffer.from('this is not an archive'));
    const r = await verifyBackup(name);
    assert.equal(r.ok, false);
    assert.ok(r.message.length > 0);
    assert.equal(lastVerify()?.ok, false);
    fs.rmSync(path.join(BACKUP_DIR, name));
  });

  it('an unknown name is a failed check', async () => {
    const r = await verifyBackup('../../etc/passwd');
    assert.equal(r.ok, false);
  });

  it('runVerifyIfDue checks the newest copy once and then waits a week', async () => {
    setSetting('backup_verify', '');
    const first = await runVerifyIfDue(Date.now() + 10 * 60_000);
    assert.ok(first, 'due: the copy is older than five minutes');
    assert.equal(await runVerifyIfDue(Date.now() + 11 * 60_000 + 1000), null);
    assert.ok(await runVerifyIfDue(Date.now() + 8 * 86400_000), 'a week later it is due again');
  });
});
