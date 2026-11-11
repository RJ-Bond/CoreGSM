/** The «Баны» page: what a guest sees and what only the staff sees, the filters, the short block after a kick that is not listed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-bans-'));
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ??= 'i'.repeat(48);
const { shapeBans } = await import('../src/gamenews/bansPublic.ts');
type Row = Parameters<typeof shapeBans>[0][number];

const row = (o: Partial<Row>): Row => ({ platform_id: '76561198000000011', nick: 'Alpha', reason: 'cheats', admin: 'Boss', created_at: 1000, until: 0, kind: 'ban', server_id: 1, scope: 'all', ...o });
const label = (id: number) => `Server ${id}`;

describe('the list of bans in the shape that is given out', () => {
  const rows = [
    row({}),
    row({ platform_id: '2', nick: 'Beta', reason: 'insults', scope: 'server', server_id: 2, until: 5000 }),
    row({ platform_id: '3', nick: 'Gamma', kind: 'block', reason: 'kick' }),
  ];
  it('shows a guest the nickname, the reason and the server, and not the account or the administrator', () => {
    const out = shapeBans(rows, { staff: false, label });
    assert.equal(out.length, 2, 'a short block after a kick is not a ban');
    for (const b of out) {
      assert.equal('admin' in b, false);
      assert.equal('platformId' in b, false);
    }
    assert.equal(out[0].server, 'Server 1');
  });
  it('shows the staff the account and who gave the ban', () => {
    const out = shapeBans(rows, { staff: true, label });
    assert.equal(out[0].admin, 'Boss');
    assert.equal(out[0].platformId, '76561198000000011');
  });
  it('filters by a server (a ban of all servers holds everywhere) and by a piece of the nickname or the reason', () => {
    assert.deepEqual(shapeBans(rows, { staff: false, server: 1, label }).map((b) => b.nick), ['Alpha']);
    assert.deepEqual(shapeBans(rows, { staff: false, server: 2, label }).map((b) => b.nick), ['Alpha', 'Beta']);
    assert.deepEqual(shapeBans(rows, { staff: false, q: 'INSULT', label }).map((b) => b.nick), ['Beta']);
    assert.deepEqual(shapeBans(rows, { staff: false, q: 'alp', label }).map((b) => b.nick), ['Alpha']);
  });
});

describe('api: /api/bans', () => {
  let api: Api;
  let token = '';
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('answers an open panel with an empty list and the figures, for a guest and for the staff', async () => {
    for (const t of [undefined, token]) {
      const r = await api.call('GET', '/api/bans', t ? { token: t } : {});
      assert.equal(r.status, 200);
      const b = r.body as { total: number; forever: number; last7d: number; servers: unknown[]; items: unknown[] };
      assert.deepEqual([b.total, b.forever, b.last7d, b.servers.length, b.items.length], [0, 0, 0, 0, 0]);
    }
  });
  it('wants a sign-in when the panel is closed to guests', async () => {
    const off = await api.call('PUT', '/api/access', { token, body: { publicPanel: false } });
    assert.ok(off.status < 300, `the switch works: ${off.status}`);
    assert.equal((await api.call('GET', '/api/bans')).status, 401);
    assert.equal((await api.call('GET', '/api/bans', { token })).status, 200);
  });
});
