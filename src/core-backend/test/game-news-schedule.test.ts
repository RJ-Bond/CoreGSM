import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GRACE_MS, cleanTimes, dueState, inWindow, isHHMM, nextRunAfter, type Schedule } from '../src/gamenews/gameNewsSchedule.ts';

const MSK = 'Europe/Moscow'; // UTC+3, no daylight saving
const base: Schedule = { kind: 'daily', everyMin: 0, times: [], runAt: null };

describe('game news schedule', () => {
  it('interval: the next run is N minutes after', () => {
    const now = Date.UTC(2026, 10, 7, 10, 0);
    assert.equal(nextRunAfter({ ...base, kind: 'interval', everyMin: 30 }, now, MSK), now + 30 * 60_000);
    // never faster than the minimum
    assert.equal(nextRunAfter({ ...base, kind: 'interval', everyMin: 1 }, now, MSK), now + 5 * 60_000);
  });

  it('daily: the next time of the day in the panel time zone', () => {
    // 07.11.2026 10:00 UTC = 13:00 in Moscow; the times are Moscow wall-clock
    const now = Date.UTC(2026, 10, 7, 10, 0);
    const s = { ...base, times: ['12:00', '20:00'] };
    assert.equal(nextRunAfter(s, now, MSK), Date.UTC(2026, 10, 7, 17, 0)); // 20:00 MSK
    // after the last time of the day: the first one of the next day
    assert.equal(nextRunAfter(s, Date.UTC(2026, 10, 7, 18, 0), MSK), Date.UTC(2026, 10, 8, 9, 0)); // 12:00 MSK
  });

  it('daily: a time equal to now is not repeated', () => {
    const t = Date.UTC(2026, 10, 7, 9, 0); // 12:00 MSK
    assert.equal(nextRunAfter({ ...base, times: ['12:00'] }, t, MSK), Date.UTC(2026, 10, 8, 9, 0));
  });

  it('daily: no times means no run', () => {
    assert.equal(nextRunAfter(base, Date.now(), MSK), null);
  });

  it('once: only while it is in the future', () => {
    const now = Date.UTC(2026, 10, 7, 10, 0);
    assert.equal(nextRunAfter({ ...base, kind: 'once', runAt: now + 1000 }, now, MSK), now + 1000);
    assert.equal(nextRunAfter({ ...base, kind: 'once', runAt: now - 1000 }, now, MSK), null);
  });

  it('cleans and validates times', () => {
    assert.equal(isHHMM('09:05'), true);
    assert.equal(isHHMM('9:05'), false);
    assert.equal(isHHMM('24:00'), false);
    assert.deepEqual(cleanTimes(['20:00', '12:00', '20:00', 'x', '25:00']), ['12:00', '20:00']);
  });

  it('window of dates', () => {
    assert.equal(inWindow(5, null, null), true);
    assert.equal(inWindow(5, 6, null), false);
    assert.equal(inWindow(5, null, 4), false);
    assert.equal(inWindow(5, 1, 9), true);
  });

  it('a late run is skipped, a fresh one is sent', () => {
    const now = 1_000_000;
    assert.equal(dueState(null, now), 'wait');
    assert.equal(dueState(now + 1, now), 'wait');
    assert.equal(dueState(now - 1000, now), 'fire');
    assert.equal(dueState(now - GRACE_MS - 1, now), 'skip');
  });
});

import { upcomingRuns } from '../src/gamenews/gameNewsSchedule.ts';

describe('upcoming runs', () => {
  it('lists the next runs of an interval and of a daily rule', () => {
    const t0 = Date.UTC(2026, 10, 7, 10, 0);
    assert.deepEqual(upcomingRuns({ ...base, kind: 'interval', everyMin: 30 }, t0, 3, MSK), [t0, t0 + 30 * 60_000, t0 + 60 * 60_000]);
    const d = upcomingRuns({ ...base, times: ['12:00', '20:00'] }, Date.UTC(2026, 10, 7, 9, 0), 3, MSK);
    assert.deepEqual(d, [Date.UTC(2026, 10, 7, 9, 0), Date.UTC(2026, 10, 7, 17, 0), Date.UTC(2026, 10, 8, 9, 0)]);
  });
  it('a once rule has one run, a rule without a next run none', () => {
    assert.deepEqual(upcomingRuns({ ...base, kind: 'once', runAt: 5 }, 5, 5, MSK), [5]);
    assert.deepEqual(upcomingRuns(base, null, 5, MSK), []);
  });
});
