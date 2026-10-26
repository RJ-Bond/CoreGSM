import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAttention, diskLevel, shouldAlertDisk, type AttentionInput } from '../src/attentionLogic.ts';

const now = 1_800_000_000_000;
const base = (o: Partial<AttentionInput> = {}): AttentionInput => ({
  now, serversDown: [], deadDeliveries: 0, backup: { schedule: 'daily', lastAt: now - 3600_000 }, certDays: 60, updateLabel: null,
  botState: 'online', disk: { free: 50 * 1024 ** 3, total: 100 * 1024 ** 3 }, pendingUsers: 0, openReports: 0, flaggedComments: 0, ...o,
});

describe('diskLevel', () => {
  it('thresholds', () => {
    assert.equal(diskLevel(50 * 1024 ** 3, 100 * 1024 ** 3), 'ok');
    assert.equal(diskLevel(14 * 1024 ** 3, 100 * 1024 ** 3), 'warn');
    assert.equal(diskLevel(6 * 1024 ** 3, 100 * 1024 ** 3), 'bad');
    assert.equal(diskLevel(500 * 1024 ** 2, 2 * 1024 ** 3), 'bad');
    assert.equal(diskLevel(null, null), 'ok');
  });
});

describe('buildAttention', () => {
  it('empty when all is fine', () => assert.deepEqual(buildAttention(base()), []));
  it('sorts bad before warn before info', () => {
    const r = buildAttention(base({ pendingUsers: 2, deadDeliveries: 1, serversDown: ['A', 'B'], updateLabel: '1.0' }));
    assert.deepEqual(r.map((x) => x.id), ['servers_down', 'deliveries_dead', 'users_pending', 'update']);
    assert.equal(r[0]!.n, 2);
  });
  it('backup: none and old', () => {
    assert.equal(buildAttention(base({ backup: { schedule: 'daily', lastAt: null } }))[0]!.id, 'backup_none');
    const old = buildAttention(base({ backup: { schedule: 'daily', lastAt: now - 5 * 86_400_000 } }));
    assert.equal(old[0]!.id, 'backup_old');
    assert.equal(old[0]!.n, 5);
    assert.deepEqual(buildAttention(base({ backup: { schedule: 'weekly', lastAt: now - 5 * 86_400_000 } })), []);
  });
  it('cert: warn within 14 days, bad within 3', () => {
    assert.equal(buildAttention(base({ certDays: 10 }))[0]!.tone, 'warn');
    assert.equal(buildAttention(base({ certDays: 2 }))[0]!.tone, 'bad');
    assert.deepEqual(buildAttention(base({ certDays: 15 })), []);
  });
  it('bot error and disk', () => {
    assert.equal(buildAttention(base({ botState: 'error' }))[0]!.id, 'bot');
    const d = buildAttention(base({ disk: { free: 10, total: 100 } }));
    assert.equal(d[0]!.id, 'disk');
    assert.equal(d[0]!.tone, 'bad');
  });
});

describe('shouldAlertDisk', () => {
  const day = 86_400_000;
  it('rules', () => {
    assert.equal(shouldAlertDisk('ok', 'bad', 0, now), false);
    assert.equal(shouldAlertDisk('warn', 'ok', now, now), true);
    assert.equal(shouldAlertDisk('warn', 'warn', now - 1000, now), false);
    assert.equal(shouldAlertDisk('bad', 'warn', now - 1000, now), true);
    assert.equal(shouldAlertDisk('bad', 'bad', now - day, now), true);
    assert.equal(shouldAlertDisk('warn', 'bad', now - 1000, now), false);
  });
});
