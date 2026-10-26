import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { completeOrder } from '../src/serverOrderLogic.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('completeOrder', () => {
  it('keeps the placed ids first and the rest in their old order', () => {
    assert.deepEqual(completeOrder([3, 1], [1, 2, 3, 4]), [3, 1, 2, 4]);
  });
  it('drops unknown ids and duplicates', () => {
    assert.deepEqual(completeOrder([9, 2, 2, 1], [1, 2, 3]), [2, 1, 3]);
  });
  it('an empty request leaves the order as is', () => {
    assert.deepEqual(completeOrder([], [5, 4]), [5, 4]);
  });
});

describe('api: server order', () => {
  let api: Api;
  const ids: number[] = [];
  before(async () => {
    api = await startBackend();
    await setupAdmin(api);
    const db = new Database(api.dbPath);
    for (const n of ['A', 'B', 'C']) ids.push(Number(db.prepare("INSERT INTO servers (name, game, host, port, created_at) VALUES (?, 'minecraft', '127.0.0.1', 25565, ?)").run(n, Date.now()).lastInsertRowid));
    db.close();
  });
  after(async () => { await api.stop(); });

  it('lists by id until the order is saved, then by the saved order', async () => {
    const names = async () => ((await api.call('GET', '/api/servers')).body as { name: string }[]).map((s) => s.name);
    assert.deepEqual(await names(), ['A', 'B', 'C']);
    const r = await api.call('PUT', '/api/servers/order', { ids: [ids[2], ids[0]] });
    assert.equal(r.status, 200);
    assert.deepEqual(await names(), ['C', 'A', 'B']);
  });

  it('rejects a body without ids', async () => {
    const r = await api.call('PUT', '/api/servers/order', { ids: 'x' });
    assert.equal(r.status, 400);
  });
});
