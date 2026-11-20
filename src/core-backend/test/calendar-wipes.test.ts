/** The planned wipes go into the calendar feed (and only the ones that have not started). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-cal-'));
process.env.JWT_SECRET ||= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ||= 'i'.repeat(48);
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.NODE_ENV = 'test';
const { db } = await import('../src/db.ts');
await import('../src/monitoring/wipes.ts'); // creates the table
// the table of the news is made by the news module; the feed only reads three columns of it
db.exec('CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY, payload TEXT, test INTEGER, status TEXT)');
const { upcomingEvents } = await import('../src/community/calendar.ts');

const NOW = 1_800_000_000_000;
describe('calendar of the community', () => {
  it('lists a planned wipe with the server and the length, not a finished one or one in the past', () => {
    const id = Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES ('Rust A', 'rust', '127.0.0.1', 28015, ?)").run(NOW).lastInsertRowid);
    const add = db.prepare("INSERT INTO wipe_scenarios (server_id, name, wipe_at, status, duration_min, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    add.run(id, 'Monthly', NOW + 3 * 86_400_000, 'scheduled', 30, NOW);
    add.run(id, 'Done', NOW + 4 * 86_400_000, 'done', 15, NOW);
    add.run(id, 'Past', NOW - 86_400_000, 'scheduled', 15, NOW);
    const wipes = upcomingEvents(NOW).filter((e) => e.uid.startsWith('wipe-'));
    assert.equal(wipes.length, 1);
    assert.equal(wipes[0]!.summary, 'Вайп: Rust A');
    assert.equal(wipes[0]!.description, 'Monthly');
    assert.equal(wipes[0]!.end - wipes[0]!.start, 30 * 60_000);
  });
});
