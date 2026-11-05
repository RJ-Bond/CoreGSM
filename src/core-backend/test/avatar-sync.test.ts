import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextBatch } from '../src/discord/avatarSyncLogic.ts';

const rows = [5, 1, 9, 3].map((id) => ({ id }));

test('a round goes by id and wraps around', () => {
  assert.deepEqual(nextBatch(rows, 0, 2).map((r) => r.id), [1, 3]);
  assert.deepEqual(nextBatch(rows, 3, 3).map((r) => r.id), [5, 9, 1]);
  assert.deepEqual(nextBatch(rows, 9, 2).map((r) => r.id), [1, 3]);
  assert.deepEqual(nextBatch([], 0, 5), []);
});
