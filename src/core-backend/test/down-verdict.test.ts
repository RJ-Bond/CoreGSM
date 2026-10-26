import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideStatus } from '../src/pollLogic.ts';
import { judgeDown, MAX_WINDOW, resolveRule } from '../src/downVerdict.ts';

const R = (n: number, m: number, probeVeto = false) => ({ n, m, probeVeto });

describe('resolveRule', () => {
  it('without own n and m the threshold decides (n = m = threshold, not custom)', () => {
    assert.deepEqual(resolveRule({}, 2), { n: 2, m: 2, probeVeto: false, custom: false });
    assert.deepEqual(resolveRule({ n: '', m: null }, 4), { n: 4, m: 4, probeVeto: false, custom: false });
  });
  it('n larger than m is cut to m; values are limited to 1..MAX_WINDOW', () => {
    const r = resolveRule({ n: 9, m: 3 }, 2);
    assert.equal(r.n, 3);
    assert.equal(r.m, 3);
    assert.equal(resolveRule({ n: 500, m: 500 }, 2).m, MAX_WINDOW);
    assert.equal(resolveRule({ n: 0, m: 0 }, 2).n, 1);
  });
  it('only one of the two set: the other follows the threshold', () => {
    assert.deepEqual(resolveRule({ m: 5 }, 2), { n: 2, m: 5, probeVeto: false, custom: true });
    assert.deepEqual(resolveRule({ n: 4 }, 2), { n: 4, m: 4, probeVeto: false, custom: true });
    assert.deepEqual(resolveRule({ n: 1 }, 3), { n: 1, m: 3, probeVeto: false, custom: true });
  });
  it('the probe switch accepts 1 and true', () => {
    assert.equal(resolveRule({ probeVeto: '1' }, 2).probeVeto, true);
    assert.equal(resolveRule({ probeVeto: true }, 2).probeVeto, true);
    assert.equal(resolveRule({ probeVeto: '0' }, 2).probeVeto, false);
  });
  it('garbage falls back to the threshold', () => {
    assert.deepEqual(resolveRule({ n: 'abc', m: 'x' }, 3), { n: 3, m: 3, probeVeto: false, custom: false });
  });
});

describe('judgeDown', () => {
  it('n of m: three failures out of five, not in a row', () => {
    assert.equal(judgeDown({ recent: [false, true, false, true, false], rule: R(3, 5) }).down, true);
    assert.equal(judgeDown({ recent: [false, true, false, true, true], rule: R(3, 5) }).down, false);
  });
  it('only the last m checks count', () => {
    assert.equal(judgeDown({ recent: [false, false, false, true, true, true], rule: R(2, 3) }).down, false);
    assert.equal(judgeDown({ recent: [true, true, false, false], rule: R(2, 3) }).down, true);
  });
  it('m larger than the history: what exists is counted, and n cannot be reached early', () => {
    const v = judgeDown({ recent: [false, false], rule: R(3, 10) });
    assert.deepEqual([v.down, v.failed, v.seen], [false, 2, 2]);
    assert.equal(judgeDown({ recent: [false, false, false], rule: R(3, 10) }).down, true);
    assert.equal(judgeDown({ recent: [], rule: R(1, 3) }).down, false);
  });
  it('n larger than m behaves as n = m', () => {
    assert.equal(judgeDown({ recent: [false, false], rule: R(5, 2) }).down, true);
    assert.equal(judgeDown({ recent: [true, false], rule: R(5, 2) }).down, false);
  });
  it('a changed rule applies at once to the same history', () => {
    const recent = [false, true, false, false];
    assert.equal(judgeDown({ recent, rule: R(3, 3) }).down, false); // true,false,false
    assert.equal(judgeDown({ recent, rule: R(3, 4) }).down, true);
    assert.equal(judgeDown({ recent, rule: R(2, 2) }).down, true);
  });
  it('1 of 1 is the immediate verdict', () => {
    assert.equal(judgeDown({ recent: [true, true, false], rule: R(1, 1) }).down, true);
  });
  describe('probes', () => {
    const base = [false, false];
    it('are ignored when the veto is off', () => {
      assert.equal(judgeDown({ recent: base, rule: R(2, 2, false), probes: [true, true] }).down, true);
    });
    it('most of the probes see the server: the verdict is vetoed', () => {
      const v = judgeDown({ recent: base, rule: R(2, 2, true), probes: [true, true, false] });
      assert.deepEqual([v.down, v.vetoed], [false, true]);
    });
    it('probes split evenly: no veto, the outage stands', () => {
      assert.equal(judgeDown({ recent: base, rule: R(2, 2, true), probes: [true, false] }).down, true);
    });
    it('most of the probes agree it is down; or there are none', () => {
      assert.equal(judgeDown({ recent: base, rule: R(2, 2, true), probes: [false, false, true] }).down, true);
      assert.equal(judgeDown({ recent: base, rule: R(2, 2, true), probes: [] }).down, true);
      assert.equal(judgeDown({ recent: base, rule: R(2, 2, true) }).down, true);
    });
    it('the panel itself still answers: probes cannot make it down', () => {
      assert.equal(judgeDown({ recent: [false, true], rule: R(2, 2, true), probes: [false, false] }).down, false);
    });
  });
});

describe('decideStatus with the n-of-m verdict', () => {
  const base = { prevOnline: true, prevFailures: 0, polledOnline: false, threshold: 2 };
  it('without a verdict the old threshold works as before', () => {
    assert.equal(decideStatus({ ...base, prevFailures: 0 }).confirmed, false);
    assert.equal(decideStatus({ ...base, prevFailures: 1 }).becameOffline, true);
  });
  it('a verdict replaces the threshold', () => {
    assert.equal(decideStatus({ ...base, prevFailures: 0, confirmDown: true }).becameOffline, true);
    assert.equal(decideStatus({ ...base, prevFailures: 5, confirmDown: false }).confirmed, false);
  });
  it('a successful poll and an already offline server ignore it', () => {
    assert.equal(decideStatus({ ...base, polledOnline: true, confirmDown: false }).online, true);
    assert.equal(decideStatus({ ...base, prevOnline: false, confirmDown: false }).confirmed, true);
  });
});
