import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLadder, pickStep } from '../src/gamenews/warnLadder.ts';

const base = { warnLimit: 3, warnAction: 'kick' as const, warnBanTime: '1d' };

describe('warnLadder', () => {
  it('cleans the steps: sorted, one per count, no garbage', () => {
    const l = cleanLadder([{ at: 5, action: 'ban', time: '7d' }, { at: 2, action: 'kick' }, { at: 2, action: 'ban' }, { at: 0 }, null, { at: 99 }]);
    assert.deepEqual(l.map((x) => x.at), [2, 5]);
    assert.equal(l[0].action, 'kick');
    assert.equal(cleanLadder('x').length, 0);
  });
  it('without a ladder the old limit works', () => {
    assert.equal(pickStep({ ...base, ladder: [] }, 2).step, null);
    assert.deepEqual(pickStep({ ...base, ladder: [] }, 3).step, { action: 'kick', time: '1d' });
    assert.equal(pickStep({ ...base, warnLimit: 0, ladder: [] }, 9).step, null);
  });
  it('a rung fires exactly when the count reaches it', () => {
    const ladder = cleanLadder([{ at: 2, action: 'kick' }, { at: 3, action: 'ban', time: '1d' }, { at: 5, action: 'ban', time: 'перм' }]);
    const at = (n: number) => pickStep({ ...base, ladder }, n);
    assert.equal(at(1).step, null);
    assert.equal(at(2).step?.action, 'kick');
    assert.deepEqual(at(3).step, { action: 'ban', time: '1d' });
    assert.equal(at(4).step, null);
    assert.equal(at(5).step?.time, 'перм');
    assert.equal(at(1).limit, 2);
    assert.equal(at(4).limit, 5);
    assert.equal(at(6).limit, 5);
  });
});
