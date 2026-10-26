import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activeBan, banUntil } from '../src/banLogic.ts';

const NOW = 1_000_000_000;
describe('activeBan', () => {
  it('no ban', () => assert.equal(activeBan({ banned_at: null, banned_until: null, ban_reason: null }, NOW), null));
  it('permanent', () => assert.deepEqual(activeBan({ banned_at: 5, banned_until: null, ban_reason: 'спам' }, NOW), { until: null, reason: 'спам', at: 5 }));
  it('timed, still running', () => assert.equal(activeBan({ banned_at: 5, banned_until: NOW + 1, ban_reason: '' }, NOW)?.until, NOW + 1));
  it('timed, ran out', () => assert.equal(activeBan({ banned_at: 5, banned_until: NOW, ban_reason: '' }, NOW), null));
});
describe('banUntil', () => {
  it('permanent without hours', () => { assert.equal(banUntil(null, NOW), null); assert.equal(banUntil(0, NOW), null); });
  it('hours to ms', () => assert.equal(banUntil(2, NOW), NOW + 7_200_000));
  it('capped at a year, at least an hour', () => {
    assert.equal(banUntil(99999, NOW), NOW + 8760 * 3_600_000);
    assert.equal(banUntil(0.2, NOW), NOW + 3_600_000);
  });
});
