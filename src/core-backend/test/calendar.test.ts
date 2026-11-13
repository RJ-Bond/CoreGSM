/** The feed of events for calendar programs: escaping, folding, and what lands in it. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// the module opens the database of the panel: it gets one of its own
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-cal-'));
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ??= 'i'.repeat(48);
const { buildIcs, fold } = await import('../src/community/calendar.ts');

describe('the calendar text', () => {
  it('folds long lines at 75 bytes and escapes the special characters', () => {
    const long = `SUMMARY:${'я'.repeat(60)}`;
    for (const part of fold(long).split('\r\n')) assert.ok(Buffer.byteLength(part) <= 75, 'a piece is at most 75 bytes');
    assert.equal(fold(long).replace(/\r\n /g, ''), long, 'nothing is lost in the folding');
    const ics = buildIcs([{ uid: 'u1', start: 1_900_000_000_000, end: 1_900_003_600_000, summary: 'Вайп, часть 1; финал\nначало' }], 1_800_000_000_000, 'Cal');
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
    assert.ok(ics.includes('SUMMARY:Вайп\\, часть 1\\; финал\\nначало'));
    assert.ok(ics.includes('DTSTART:20300317T174640Z'), ics);
  });
});

describe('api: /api/events.ics', () => {
  let api: Api;
  before(async () => {
    api = await startBackend();
    const admin = await setupAdmin(api);
    const { default: Database } = await import('better-sqlite3');
    const d = new Database(api.dbPath);
    const mk = async (payload: unknown) => {
      const id = ((await api.call('POST', '/api/news', { token: admin, body: { channelId: '123456789012345678', action: 'draft', payload } })).body as { id: number }).id;
      d.prepare("UPDATE news SET status = 'sent', sent_at = ?, message_id = '1' WHERE id = ?").run(Date.now(), id);
    };
    await mk({ content: 'x', embed: { title: 'Weekend event' }, countdownAt: Date.now() + 86_400_000 });
    await mk({ content: 'x', embed: { title: 'Past event' }, countdownAt: Date.now() - 86_400_000 });
    await mk({ content: 'no countdown' });
    d.close();
  });
  after(async () => { await api.stop(); });

  it('lists only the events that are still ahead', async () => {
    const r = await fetch(`${api.base}/api/events.ics`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /text\/calendar/);
    const text = await r.text();
    assert.ok(text.includes('Weekend event'));
    assert.ok(!text.includes('Past event'));
    assert.equal((text.match(/BEGIN:VEVENT/g) ?? []).length, 1);
  });
});
