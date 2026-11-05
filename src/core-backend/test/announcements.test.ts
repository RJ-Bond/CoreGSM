import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { nextRun, validateAnnouncement } from '../src/alerts/announcementLogic.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const NOW = Date.UTC(2026, 10, 5, 12, 0);
const ok = { text: 'Рестарт в 4 утра', channelId: '123456789012345678', at: NOW + 3600_000 };

describe('announcement form', () => {
  it('accepts a good one and refuses the broken ones', () => {
    assert.equal(validateAnnouncement(ok, NOW).ok, true);
    assert.equal(validateAnnouncement({ ...ok, text: '  ' }, NOW).ok, false);
    assert.equal(validateAnnouncement({ ...ok, channelId: 'general' }, NOW).ok, false);
    assert.equal(validateAnnouncement({ ...ok, at: NOW - 3600_000 }, NOW).ok, false);
    assert.equal(validateAnnouncement({ ...ok, at: NOW + 400 * 86_400_000 }, NOW).ok, false);
    assert.equal(validateAnnouncement({ ...ok, text: 'x'.repeat(1801) }, NOW).ok, false);
    const v = validateAnnouncement({ ...ok, repeat: 'hourly', mention: 'all' }, NOW);
    assert.ok(v.ok && v.value.repeat === 'none' && v.value.mention === 'none');
  });
});

describe('nextRun', () => {
  it('does not repeat once, steps a day or a week, and never lands in the past', () => {
    assert.equal(nextRun(NOW, 'none', NOW), null);
    assert.equal(nextRun(NOW, 'daily', NOW), NOW + 86_400_000);
    assert.equal(nextRun(NOW, 'weekly', NOW), NOW + 7 * 86_400_000);
    // the panel was off for 3.5 days: one send, the next run on the grid after now
    const late = NOW + 3.5 * 86_400_000;
    assert.equal(nextRun(NOW, 'daily', late), NOW + 4 * 86_400_000);
  });
});

describe('api: announcements', () => {
  let api: Api;
  let token = '';
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('needs an administrator, creates, lists and deletes', async () => {
    assert.equal((await api.call('GET', '/api/announcements')).status, 401);
    const body = { text: 'Рестарт в 4 утра', channelId: '123456789012345678', at: Date.now() + 3600_000, repeat: 'daily' };
    assert.equal((await api.call('POST', '/api/announcements', { token, body: { ...body, text: '' } })).status, 400);
    const made = await api.call('POST', '/api/announcements', { token, body });
    assert.equal(made.status, 200);
    const id = (made.body as { id: number }).id;
    const list = (await api.call('GET', '/api/announcements', { token })).body as { id: number; repeat: string }[];
    assert.deepEqual(list.map((x) => [x.id, x.repeat]), [[id, 'daily']]);
    assert.equal((await api.call('DELETE', `/api/announcements/${id}`, { token })).status, 200);
    assert.equal((await api.call('DELETE', `/api/announcements/${id}`, { token })).status, 404);
  });
});
