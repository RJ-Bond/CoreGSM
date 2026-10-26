/** Quiet hours of the push notifications (pure logic). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hhmm, inQuiet, localMinutes, parseHhmm, type Quiet } from '../src/quietLogic.ts';

const at = (h: number, m = 0) => Date.UTC(2026, 9, 26, h, m);
const night: Quiet = { enabled: true, fromMin: 23 * 60, toMin: 8 * 60, tz: 180 };

describe('quiet hours', () => {
  it('converts a UTC instant to the local minute of the day', () => {
    assert.equal(localMinutes(at(21, 30), 180), 30);
    assert.equal(localMinutes(at(1, 0), -300), 20 * 60);
  });
  it('a window across midnight', () => {
    assert.equal(inQuiet(night, at(20, 0)), true); // 23:00 in Moscow
    assert.equal(inQuiet(night, at(4, 59)), true); // 07:59
    assert.equal(inQuiet(night, at(5, 0)), false); // 08:00
    assert.equal(inQuiet(night, at(19, 59)), false); // 22:59
  });
  it('a window inside a day, and the edge cases', () => {
    const day: Quiet = { enabled: true, fromMin: 13 * 60, toMin: 15 * 60, tz: 0 };
    assert.equal(inQuiet(day, at(13)), true);
    assert.equal(inQuiet(day, at(15)), false);
    assert.equal(inQuiet({ ...day, enabled: false }, at(14)), false);
    assert.equal(inQuiet({ ...day, toMin: day.fromMin }, at(14)), false);
  });
  it('formats and parses the time', () => {
    assert.equal(hhmm(8 * 60 + 5), '08:05');
    assert.equal(parseHhmm('23:59'), 23 * 60 + 59);
    assert.equal(parseHhmm('24:00'), null);
    assert.equal(parseHhmm('x'), null);
  });
});
