import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

// the modules open the database on import: point them at a throw-away one first
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-logic-')), 'coregsm.db');
const del = await import('../src/deliveries.ts');
const subs = await import('../src/subscriptions.ts');

describe('delivery backoff', () => {
  it('follows 30 s, 1, 2, 5, 15 min and stays at 15 min', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(del.backoffMs), [30_000, 60_000, 120_000, 300_000, 900_000, 900_000, 900_000]);
  });

  it('schedules a retry after a failure and goes dead after 8 attempts', () => {
    const now = 1_000_000;
    let attempts = 0;
    const plans = [];
    for (let i = 0; i < 8; i++) {
      const p = del.planFailure(attempts, now);
      plans.push(p);
      attempts = p.attempts;
    }
    assert.equal(plans[0]!.status, 'error');
    assert.equal(plans[0]!.nextTryAt, now + 30_000);
    assert.equal(plans[3]!.nextTryAt, now + 300_000);
    assert.equal(plans[6]!.status, 'error');
    assert.equal(plans[7]!.status, 'dead');
    assert.equal(plans[7]!.attempts, 8);
    assert.equal(plans[7]!.nextTryAt, null);
  });

  it('honours Discord retry-after and a final error', () => {
    assert.equal(del.planFailure(0, 0, { retryAfterMs: 120_000 }).nextTryAt, 120_000);
    assert.equal(del.planFailure(0, 0, { retryAfterMs: 1_000 }).nextTryAt, 30_000);
    assert.equal(del.planFailure(0, 0, { final: true }).status, 'dead');
  });
});

describe('delivery queue', () => {
  it('claims due deliveries once and records attempts', () => {
    const id = del.enqueueDelivery({ kind: 'dm', target: '123', payload: { content: 'hi' } });
    const first = del.claimDue(['dm'], Date.now());
    assert.ok(first.some((d) => d.id === id));
    assert.equal(del.claimDue(['dm'], Date.now()).some((d) => d.id === id), false, 'a claimed delivery is not handed out again');
    del.reportResult(id, { ok: false, error: 'нет прав' }, 1000);
    // the retry is not due before the backoff has passed
    assert.equal(del.claimDue(['dm'], 1000 + 29_000).some((d) => d.id === id), false);
    assert.equal(del.claimDue(['dm'], 1000 + 31_000).some((d) => d.id === id), true);
    del.reportResult(id, { ok: true });
  });
});

describe('subscription transitions', () => {
  const up = (players: number, maxPlayers = 10) => ({ online: true, players, maxPlayers });
  const down = { online: false, players: 0, maxPlayers: 0 };

  it('fires nothing on the first poll', () => {
    assert.deepEqual(subs.nextTrack(null, up(10)).events, []);
    assert.deepEqual(subs.nextTrack(null, down).events, []);
  });

  it('free_slot fires once when a full server gets room, and re-arms when full again', () => {
    const t = subs.nextTrack(null, up(10)).next;
    const a = subs.nextTrack(t, up(9));
    assert.deepEqual(a.events, ['free_slot']);
    const b = subs.nextTrack(a.next, up(8));
    assert.deepEqual(b.events, []);
    const full = subs.nextTrack(b.next, up(10));
    assert.deepEqual(full.events, []);
    assert.deepEqual(subs.nextTrack(full.next, up(9)).events, ['free_slot']);
  });

  it('went_down needs two failed polls, back_online follows the recovery', () => {
    const t0 = subs.nextTrack(null, up(2)).next;
    const f1 = subs.nextTrack(t0, down);
    assert.deepEqual(f1.events, []);
    const f2 = subs.nextTrack(f1.next, down);
    assert.deepEqual(f2.events, ['went_down']);
    assert.deepEqual(subs.nextTrack(f2.next, down).events, [], 'only once');
    assert.deepEqual(subs.nextTrack(f2.next, up(2)).events, ['back_online']);
  });

  it('a single failed poll does not produce back_online', () => {
    const t0 = subs.nextTrack(null, up(2)).next;
    const f1 = subs.nextTrack(t0, down);
    assert.deepEqual(subs.nextTrack(f1.next, up(2)).events, []);
  });

  it('allows one notification per 10 minutes', () => {
    assert.equal(subs.mayNotify(null, 5), true);
    assert.equal(subs.mayNotify(1_000, 1_000 + 9 * 60_000), false);
    assert.equal(subs.mayNotify(1_000, 1_000 + 10 * 60_000), true);
  });
});
