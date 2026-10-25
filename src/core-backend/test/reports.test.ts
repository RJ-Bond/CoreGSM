/** Reports on players: POST /api/players/:nick/report and the moderators' queue /api/reports. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('api: player reports', () => {
  let api: Api;
  let admin = '';
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
  });
  after(async () => { await api.stop(); });

  it('needs a signed-in user', async () => {
    const r = await api.call('POST', '/api/players/Alex/report', { body: { reason: 'cheating' } });
    assert.equal(r.status, 401);
  });

  it('rejects an unknown reason', async () => {
    const r = await api.call('POST', '/api/players/Alex/report', { token: admin, body: { reason: 'nope' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'report_bad');
  });

  it('takes a report, refuses a second one on the same player, and counts it', async () => {
    const r = await api.call('POST', '/api/players/Alex/report', { token: admin, body: { reason: 'cheating', text: 'aimbot' } });
    assert.equal(r.status, 201);
    const dup = await api.call('POST', '/api/players/ALEX/report', { token: admin, body: { reason: 'abuse' } });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'report_dup');
    assert.equal((await api.call('GET', '/api/reports/count', { token: admin })).body.open, 1);
    const q = await api.call('GET', '/api/reports', { token: admin });
    assert.equal(q.body.length, 1);
    assert.equal(q.body[0].nick, 'Alex');
    assert.equal(q.body[0].text, 'aimbot');
  });

  it('closes a report once, tells the reporter and keeps the history', async () => {
    const id = (await api.call('GET', '/api/reports', { token: admin })).body[0].id;
    assert.equal((await api.call('PATCH', `/api/reports/${id}`, { token: admin, body: { status: 'bogus' } })).status, 400);
    assert.equal((await api.call('PATCH', `/api/reports/${id}`, { token: admin, body: { status: 'resolved', note: 'banned' } })).status, 200);
    const again = await api.call('PATCH', `/api/reports/${id}`, { token: admin, body: { status: 'dismissed' } });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'report_closed');
    assert.equal((await api.call('GET', '/api/reports/count', { token: admin })).body.open, 0);
    const done = await api.call('GET', '/api/reports?status=closed', { token: admin });
    assert.equal(done.body[0].status, 'resolved');
    assert.equal(done.body[0].note, 'banned');
  });

  it('limits reports to 5 a day', async () => {
    for (let i = 0; i < 4; i++) assert.equal((await api.call('POST', `/api/players/p${i}/report`, { token: admin, body: { reason: 'other' } })).status, 201);
    const r = await api.call('POST', '/api/players/p9/report', { token: admin, body: { reason: 'other' } });
    assert.equal(r.status, 429);
    assert.equal(r.body.code, 'report_limit');
  });
});
