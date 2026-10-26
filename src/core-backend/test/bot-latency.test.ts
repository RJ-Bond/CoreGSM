/** Bot latency: sampling and the verdict (pure logic). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addPing, pingVerdict, thin, PING_BAD_MS, PING_GAP_MS, PING_KEEP, PING_SLOW_MS, type PingSample } from '../src/botLatencyLogic.ts';

describe('bot latency', () => {
  it('keeps one sample per minute and drops garbage', () => {
    const l: PingSample[] = [];
    addPing(l, 80, 1_000_000);
    addPing(l, 90, 1_000_000 + 10_000);
    addPing(l, -1, 1_000_000 + PING_GAP_MS * 2);
    addPing(l, NaN, 1_000_000 + PING_GAP_MS * 2);
    addPing(l, 120.4, 1_000_000 + PING_GAP_MS);
    assert.deepEqual(l.map((s) => s.ms), [80, 120]);
  });
  it('forgets the oldest samples', () => {
    const l: PingSample[] = [];
    for (let i = 0; i < PING_KEEP + 20; i++) addPing(l, i, i * PING_GAP_MS);
    assert.equal(l.length, PING_KEEP);
    assert.equal(l[0].ms, 20);
  });
  it('raises the alarm only after three slow samples in a row', () => {
    const mk = (...ms: number[]): PingSample[] => ms.map((m, i) => ({ ts: i, ms: m }));
    assert.equal(pingVerdict([]), 'unknown');
    assert.equal(pingVerdict(mk(50, 3000)), 'ok');
    assert.equal(pingVerdict(mk(50, PING_SLOW_MS, PING_SLOW_MS + 1, PING_SLOW_MS)), 'slow');
    assert.equal(pingVerdict(mk(PING_BAD_MS, PING_BAD_MS, PING_BAD_MS)), 'bad');
    assert.equal(pingVerdict(mk(PING_BAD_MS, PING_BAD_MS, 100)), 'ok');
  });
  it('thins a long series evenly, keeping both ends', () => {
    const l = Array.from({ length: 300 }, (_, i) => ({ ts: i, ms: i }));
    const t = thin(l, 50);
    assert.equal(t.length, 50);
    assert.equal(t[0].ms, 0);
    assert.equal(t[49].ms, 299);
    assert.equal(thin(l.slice(0, 5), 50).length, 5);
  });
});
