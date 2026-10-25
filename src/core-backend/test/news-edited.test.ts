/** GET /api/news/:id tells when a published news item was edited after it went out (pinning does not count). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('news: «Обновлено»', () => {
  let api: Api;
  let admin = '';
  let db: Database.Database;
  let id = 0;
  const sent = Date.now() - 86_400_000;

  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    db = new Database(api.dbPath);
    const r = await api.call('POST', '/api/news', { token: admin, body: { channelId: '123456789012345678', action: 'draft', payload: { content: 'x' } } });
    id = r.body.id as number;
    db.prepare("UPDATE news SET status = 'sent', sent_at = ?, message_id = '1' WHERE id = ?").run(sent, id);
    db.prepare('DELETE FROM news_versions WHERE news_id = ?').run(id);
  });
  after(async () => { db.close(); await api.stop(); });

  it('is empty for a news item nobody changed (a pin is not a change)', async () => {
    db.prepare("INSERT INTO news_versions (news_id, ts, actor, payload, note) VALUES (?, ?, 'a', '{}', 'Закреплено')").run(id, sent + 3_600_000);
    const r = await api.call('GET', `/api/news/${id}`, { token: admin });
    assert.equal(r.body.editedAt, null);
    assert.equal(r.body.edits, 0);
  });

  it('has the time of the last edit after the publication', async () => {
    const t1 = sent + 7_200_000;
    const t2 = sent + 10_800_000;
    const ins = db.prepare("INSERT INTO news_versions (news_id, ts, actor, payload, note) VALUES (?, ?, 'a', '{}', '')");
    ins.run(id, t1);
    ins.run(id, t2);
    const r = await api.call('GET', `/api/news/${id}`, { token: admin });
    assert.equal(r.body.editedAt, t2);
    assert.equal(r.body.edits, 2);
  });
});
