/** The shared types of the answers of the API: the copies in the backend and in the panel are the original (tools/sync-shared.mjs). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// @ts-expect-error a plain script of the repository without types
import { stale } from '../../../tools/sync-shared.mjs';

describe('shared types', () => {
  it('has no copy that is missing or differs from src/shared/types', () => {
    assert.deepEqual(stale(), [], 'run: node tools/sync-shared.mjs');
  });
});
