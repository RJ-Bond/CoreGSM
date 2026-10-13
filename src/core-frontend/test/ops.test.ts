import { describe, expect, it } from 'vitest';
import { attemptsText, canRetry, countdownText } from '../src/deliveries';
import { chipText, fromLocalInput, presetNow, presetTonight, toLocalInput, untilLabel, validateWindow, windowState } from '../src/maintenance';
import { confirmDelayText, durationText, validatePoll } from '../src/pollSettings';
import { buildSparkline, downsample } from '../src/sparkline';

const H = 3600_000;

describe('maintenance windows', () => {
  const base = { name: 'Обновление', startTs: 1_000_000, endTs: 1_000_000 + H, repeat: 'none' as const };

  it('accepts a normal window', () => {
    expect(validateWindow(base)).toBeNull();
  });

  it('needs a name, a start and an end', () => {
    expect(validateWindow({ ...base, name: '  ' })).toMatch(/название/i);
    expect(validateWindow({ ...base, startTs: null })).toMatch(/начало/i);
    expect(validateWindow({ ...base, endTs: null })).toMatch(/окончание/i);
    expect(validateWindow({ ...base, name: 'x'.repeat(81) })).toMatch(/80/);
  });

  it('end must be after start', () => {
    expect(validateWindow({ ...base, endTs: base.startTs })).toMatch(/позже/);
    expect(validateWindow({ ...base, endTs: base.startTs - 1 })).toMatch(/позже/);
  });

  it('limits the length: 7 days, and 24 hours for a daily repeat', () => {
    expect(validateWindow({ ...base, endTs: base.startTs + 7 * 24 * H })).toBeNull();
    expect(validateWindow({ ...base, endTs: base.startTs + 7 * 24 * H + 1 })).toMatch(/7 суток/);
    expect(validateWindow({ ...base, repeat: 'daily', endTs: base.startTs + 24 * H })).toBeNull();
    expect(validateWindow({ ...base, repeat: 'daily', endTs: base.startTs + 25 * H })).toMatch(/24 часов/);
    expect(validateWindow({ ...base, repeat: 'weekly', endTs: base.startTs + 25 * H })).toBeNull();
  });

  it('quick presets', () => {
    const now = new Date(2026, 9, 13, 15, 20, 45).getTime();
    const a = presetNow(now);
    expect(a.endTs - a.startTs).toBe(30 * 60_000);
    expect(a.startTs).toBeLessThanOrEqual(now);
    const t = presetTonight(now);
    expect(new Date(t.startTs).getHours()).toBe(4);
    expect(new Date(t.startTs).getDate()).toBe(14);
    expect(t.endTs - t.startTs).toBe(H);
    const early = new Date(2026, 9, 13, 2, 0, 0).getTime();
    expect(new Date(presetTonight(early).startTs).getDate()).toBe(13);
  });

  it('round-trips datetime-local values', () => {
    const ts = new Date(2026, 0, 5, 7, 8).getTime();
    expect(toLocalInput(ts)).toBe('2026-01-05T07:08');
    expect(fromLocalInput('2026-01-05T07:08')).toBe(ts);
    expect(fromLocalInput('')).toBeNull();
  });

  it('labels', () => {
    const now = new Date(2026, 9, 13, 12, 0).getTime();
    const same = new Date(2026, 9, 13, 18, 5).getTime();
    const next = new Date(2026, 9, 14, 1, 5).getTime();
    expect(untilLabel(same, now)).toBe('до 18:05');
    expect(untilLabel(next, now)).toBe('до 14.10 01:05');
    expect(chipText({ until: same }, now)).toBe('Тех. работы до 18:05');
    expect(chipText({ until: null }, now)).toBe('Тех. работы');
  });

  it('state of a window', () => {
    const now = 1000;
    expect(windowState({ active: true, repeat: 'none', endTs: 5, nextStart: null }, now)).toBe('active');
    expect(windowState({ active: false, repeat: 'daily', endTs: 5, nextStart: 9000 }, now)).toBe('repeat');
    expect(windowState({ active: false, repeat: 'none', endTs: 5000, nextStart: null }, now)).toBe('planned');
    expect(windowState({ active: false, repeat: 'none', endTs: 500, nextStart: null }, now)).toBe('past');
  });
});

describe('poll settings', () => {
  it('validates the ranges', () => {
    expect(validatePoll({ failThreshold: 3, concurrency: 8 })).toBeNull();
    expect(validatePoll({ failThreshold: 0, concurrency: 8 })).not.toBeNull();
    expect(validatePoll({ failThreshold: 6, concurrency: 8 })).not.toBeNull();
    expect(validatePoll({ failThreshold: 3, concurrency: 33 })).not.toBeNull();
    expect(validatePoll({ failThreshold: 3, concurrency: Number.NaN })).not.toBeNull();
    expect(validatePoll({ failThreshold: 2.5, concurrency: 4 })).not.toBeNull();
  });

  it('formats durations', () => {
    expect(durationText(420)).toBe('420 мс');
    expect(durationText(2500)).toBe('2,5 с');
    expect(durationText(12_400)).toBe('12 с');
    expect(durationText(95_000)).toBe('1 мин 35 с');
    expect(confirmDelayText(1)).toMatch(/сразу/);
    expect(confirmDelayText(3)).toMatch(/3/);
  });
});

describe('deliveries', () => {
  it('counts down to the next try', () => {
    const now = 1_000_000;
    expect(countdownText(null, now)).toBe('');
    expect(countdownText(now - 5, now)).toBe('сейчас');
    expect(countdownText(now + 40_000, now)).toBe('через 40 с');
    expect(countdownText(now + 3 * 60_000, now)).toBe('через 3 мин');
    expect(countdownText(now + (2 * 60 + 5) * 60_000, now)).toBe('через 2 ч 5 мин');
    expect(countdownText(now + 2 * H, now)).toBe('через 2 ч');
  });

  it('retry only for error and dead rows', () => {
    expect(canRetry('dead')).toBe(true);
    expect(canRetry('error')).toBe(true);
    expect(canRetry('pending')).toBe(false);
    expect(canRetry('sent')).toBe(false);
    expect(attemptsText(3)).toBe('3/8');
    expect(attemptsText(12)).toBe('8/8');
  });
});

describe('sparkline', () => {
  it('is empty without data', () => {
    expect(buildSparkline([], 100, 20).empty).toBe(true);
    expect(buildSparkline([null, null], 100, 20).empty).toBe(true);
  });

  it('scales to min..max and reports the last value', () => {
    const s = buildSparkline([1, 3, 2, 5], 100, 20, 0);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.last).toBe(5);
    expect(s.path.startsWith('M0,20')).toBe(true);
    expect(s.path).toContain('100,0');
  });

  it('draws a flat line in the middle and breaks at gaps', () => {
    expect(buildSparkline([4, 4, 4], 100, 20, 0).path).toBe('M0,10L50,10L100,10');
    const g = buildSparkline([1, 2, null, 3, 4], 100, 20, 0);
    expect(g.path.match(/M/g)?.length).toBe(2);
  });

  it('downsamples long series', () => {
    const v = Array.from({ length: 1000 }, (_, i) => i);
    expect(downsample(v, 100).length).toBe(100);
    expect(downsample([1, 2], 100)).toEqual([1, 2]);
  });
});
