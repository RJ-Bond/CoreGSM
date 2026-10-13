import { describe, expect, it } from 'vitest';
import {
  BRAND_ACCENT, eventCounts, filterEvents, findPeak, gameAccent, groupByDay, isFullNow, metricFill, peakWhen, sortPlayers,
} from '../src/components/server/serverLogic';

describe('game accent', () => {
  it('V Rising and Icarus keep their own colour, others use the brand', () => {
    expect(gameAccent('vrising')).toBe('#7c3aed');
    expect(gameAccent('icarus')).toBe('#f5b01e');
    expect(gameAccent('rust')).toBe(BRAND_ACCENT);
    expect(gameAccent('unknown-game')).toBe(BRAND_ACCENT);
  });
});

describe('events', () => {
  const ev = [
    { ts: 5, type: 'down' as const },
    { ts: 4, type: 'up' as const },
    { ts: 3, type: 'peak' as const },
    { ts: 2, type: 'peak' as const },
    { ts: 1, type: 'maintenance' as const },
  ];
  it('counts every type', () => {
    expect(eventCounts(ev)).toEqual({ all: 5, down: 1, up: 1, peak: 2, maintenance: 1 });
  });
  it('filters by type', () => {
    expect(filterEvents(ev, 'all')).toHaveLength(5);
    expect(filterEvents(ev, 'peak').map((e) => e.ts)).toEqual([3, 2]);
    expect(filterEvents(ev, 'maintenance')).toHaveLength(1);
  });
  it('groups by local day: today, yesterday, older', () => {
    const now = new Date(2026, 9, 13, 15, 0).getTime();
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).getTime();
    const items = [{ ts: at(13, 12) }, { ts: at(13, 9) }, { ts: at(12, 22) }, { ts: at(10, 8) }];
    const g = groupByDay(items, now);
    expect(g.map((x) => [x.kind, x.items.length])).toEqual([['today', 2], ['yesterday', 1], ['date', 1]]);
  });
});

describe('players sort', () => {
  const rows = [
    { name: 'Борис', since: 300 },
    { name: 'Алиса', since: 100 },
    { name: 'Влад', since: null },
    { name: 'Гена', since: 200 },
  ];
  it('longest in game first, unknown last', () => {
    expect(sortPlayers(rows, 'longest').map((r) => r.name)).toEqual(['Алиса', 'Гена', 'Борис', 'Влад']);
  });
  it('newest first, unknown last', () => {
    expect(sortPlayers(rows, 'newest').map((r) => r.name)).toEqual(['Борис', 'Гена', 'Алиса', 'Влад']);
  });
  it('alphabetical and does not mutate', () => {
    expect(sortPlayers(rows, 'alpha').map((r) => r.name)).toEqual(['Алиса', 'Борис', 'Влад', 'Гена']);
    expect(rows[0].name).toBe('Борис');
  });
});

describe('chart peak', () => {
  const pts = [
    { ts: 1, players: 3, online: 1, ping: 40 },
    { ts: 2, players: 9, online: 1, ping: 70 },
    { ts: 3, players: 9, online: 1, ping: 50 },
    { ts: 4, players: 20, online: 0, ping: null },
  ];
  it('latest of equal maxima, offline samples skipped', () => {
    expect(findPeak(pts, 'players')).toEqual({ value: 9, ts: 3 });
    expect(findPeak(pts, 'ping')).toEqual({ value: 70, ts: 2 });
  });
  it('null for an empty or all-zero series', () => {
    expect(findPeak([], 'players')).toBeNull();
    expect(findPeak([{ ts: 1, players: 0, online: 1, ping: 10 }], 'players')).toBeNull();
  });
  it('time label: clock inside 36 h, date and clock beyond', () => {
    const ts = new Date(2026, 9, 13, 18, 20).getTime();
    expect(peakWhen(ts, 24)).toMatch(/18[:.]20/);
    expect(peakWhen(ts, 168)).toMatch(/,/);
  });
});

describe('hero helpers', () => {
  it('full only when online with a limit and no free place', () => {
    expect(isFullNow(true, 20, 20)).toBe(true);
    expect(isFullNow(true, 25, 20)).toBe(true);
    expect(isFullNow(true, 19, 20)).toBe(false);
    expect(isFullNow(false, 20, 20)).toBe(false);
    expect(isFullNow(true, 5, 0)).toBe(false);
  });
  it('metric fill is clamped and zero without data', () => {
    expect(metricFill(10, 20)).toBe(50);
    expect(metricFill(30, 20)).toBe(100);
    expect(metricFill(null, 20)).toBe(0);
    expect(metricFill(5, 0)).toBe(0);
  });
});
