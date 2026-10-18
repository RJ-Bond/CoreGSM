import { describe, expect, it } from 'vitest';
import type { Server } from '../src/api';
import { capLevel, capacityPct, slotsInfo } from '../src/components/servers/capacity';
import { chartPoints, chartStart, hasEnoughHistory, needsAttention, pickHero, pulseOf } from '../src/components/servers/overviewLogic';
import { excerptOf } from '../src/components/servers/WhatsNew';
import { t } from '../src/i18n';
import { downBand, downRuns, smoothValues, spanCaption } from '../src/ui/charts';

const srv = (id: number, o: Partial<Server> = {}): Server => ({
  id, name: `S${id}`, customName: '', nameAuto: false, game: 'minecraft', host: '', port: 0, queryPort: null, displayAddress: '', country: '', coverUrl: null,
  address: `h${id}:1`, hasStatus: true, online: true, players: 0, maxPlayers: 20, map: null, version: null, ping: 20, playerNames: [], error: null, updatedAt: 0, maintenance: null, ...o,
}) as Server;

describe('capacity', () => {
  it('computes the fill percentage and its level', () => {
    expect(capacityPct(5, 20)).toBe(25);
    expect(capacityPct(5, 0)).toBe(0);
    expect(capacityPct(30, 20)).toBe(100);
    expect(capLevel(74)).toBe('ok');
    expect(capLevel(75)).toBe('warm');
    expect(capLevel(89)).toBe('warm');
    expect(capLevel(90)).toBe('hot');
  });

  it('reports free slots, almost full and full', () => {
    expect(slotsInfo(8, 20)).toEqual({ kind: 'free', free: 12 });
    expect(slotsInfo(18, 20)).toEqual({ kind: 'almost', free: 2 });
    expect(slotsInfo(20, 20)).toEqual({ kind: 'full', free: 0 });
    expect(slotsInfo(25, 20)).toEqual({ kind: 'full', free: 0 });
    expect(slotsInfo(3, 0)).toBeNull();
  });

  it('words the free slots with plural forms', () => {
    expect(t('srv.slots.free', { n: 12 })).toBe('Свободно 12 мест');
    expect(t('srv.slots.free', { n: 1 })).toBe('Свободно 1 место');
    expect(t('srv.slots.free', { n: 3 })).toBe('Свободно 3 места');
    expect(t('srv.slots.full')).toBe('Мест нет');
    expect(t('srv.slots.almost')).toBe('Почти полон');
  });
});

describe('hero pick', () => {
  it('keeps a server with a problem out of the hero (it goes to the compact strip)', () => {
    const list = [srv(1, { players: 15 }), srv(2, { online: false, players: 0 }), srv(3, { players: 18 })];
    expect(pickHero(list, [3])).toEqual({ server: list[2], reason: 'fav' });
    expect(pickHero(list, [2])).toEqual({ server: list[2], reason: 'busiest' });
    expect(pickHero(list, [])?.server.id).toBe(3);
  });

  it('ignores a server in maintenance and one that never answered', () => {
    const m = srv(2, { online: false, maintenance: { name: 'x', until: null } });
    const fresh = srv(3, { online: false, hasStatus: false });
    expect(needsAttention(m)).toBe(false);
    expect(needsAttention(fresh)).toBe(false);
  });

  it('when every server has a problem the worst one is the hero (offline before laggy)', () => {
    const list = [srv(1, { ping: 250 }), srv(2, { online: false })];
    expect(pickHero(list, [])).toEqual({ server: list[1], reason: 'attention' });
    expect(pickHero([list[0]], [])).toEqual({ server: list[0], reason: 'attention' });
  });

  it('takes the favourite with the most players, then the busiest', () => {
    const list = [srv(1, { players: 4 }), srv(2, { players: 9 }), srv(3, { players: 12 })];
    expect(pickHero(list, [1, 2])).toEqual({ server: list[1], reason: 'fav' });
    expect(pickHero(list, [])).toEqual({ server: list[2], reason: 'busiest' });
    expect(pickHero([], [])).toBeNull();
  });

  it('says maintenance when the picked server is in a window', () => {
    const list = [srv(1, { players: 4, maintenance: { name: 'x', until: null } })];
    expect(pickHero(list, [])?.reason).toBe('maintenance');
  });
});

describe('down bands on the sparkline', () => {
  it('stay inside the chart and cover the share of the axis of their sample', () => {
    const w = 240;
    // many samples: narrow
    const b = downBand(10, 48, w);
    expect(b.width).toBeCloseTo((w - 6) / 47, 5);
    // the first and the last sample are cut at the edges instead of sticking out
    const first = downBand(0, 4, w);
    expect(first.x).toBe(0);
    expect(first.width).toBeCloseTo((w - 6) / 3 / 2 + 3, 5);
    const last = downBand(3, 4, w);
    expect(last.x + last.width).toBe(w);
    // a single sample
    expect(downBand(0, 1, w).x).toBeGreaterThanOrEqual(0);
    for (const n of [1, 2, 3, 5, 48]) for (let i = 0; i < n; i++) {
      const d = downBand(i, n, w);
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x + d.width).toBeLessThanOrEqual(w + 1e-9);
    }
  });
});

describe('outage marks on the sparkline', () => {
  it('joins consecutive down samples into one stretch each', () => {
    const w = 240;
    const runs = downRuns([false, true, true, false, true, false], 6, w);
    expect(runs).toHaveLength(2);
    const a = downBand(1, 6, w);
    const b = downBand(2, 6, w);
    expect(runs[0].x).toBeCloseTo(a.x, 5);
    expect(runs[0].width).toBeCloseTo(b.x + b.width - a.x, 5);
    expect(downRuns([true, true], 2, w)).toHaveLength(1);
    expect(downRuns([false, false], 2, w)).toEqual([]);
    expect(downRuns([], 0, w)).toEqual([]);
  });
});

describe('smoothing of the sparkline', () => {
  it('averages the neighbours, keeps the length, the flat parts and the short series', () => {
    expect(smoothValues([0, 10, 0, 10, 0], 1)).toEqual([5, 10 / 3, 20 / 3, 10 / 3, 5]);
    expect(smoothValues([4, 4, 4, 4], 2)).toEqual([4, 4, 4, 4]);
    expect(smoothValues([1, 9], 2)).toEqual([1, 9]);
    expect(smoothValues([1, 2, 3], 0)).toEqual([1, 2, 3]);
    expect(smoothValues([], 2)).toEqual([]);
  });
});

describe('sparkline caption', () => {
  it('says how much the curve really covers', () => {
    expect(spanCaption(null)).toBe('за 24 часа');
    expect(spanCaption(24 * 60)).toBe('за 24 часа');
    expect(spanCaption(600)).toBe('за 10 ч');
    expect(spanCaption(120)).toBe('за 120 мин');
    expect(spanCaption(0)).toBe('за 1 мин');
  });
});

describe('pulse state', () => {
  it('is red for an offline server, amber for lag and maintenance, green otherwise', () => {
    expect(pulseOf([srv(1), srv(2)]).state).toBe('ok');
    expect(pulseOf([srv(1), srv(2, { online: false })]).state).toBe('bad');
    expect(pulseOf([srv(1, { ping: 300 })]).state).toBe('warn');
    expect(pulseOf([srv(1, { online: false, maintenance: { name: 'x', until: null } })]).state).toBe('maint');
    expect(pulseOf([srv(1, { hasStatus: false, online: false })]).state).toBe('wait');
  });
});

describe('chart and excerpt', () => {
  it('scales the points into the window', () => {
    const pts = chartPoints([{ ts: 0, players: 5 }, { ts: 50, players: 10 }], 0, 100);
    expect(pts).toEqual([{ x: 0, y: 0.5 }, { x: 0.5, y: 1 }]);
  });
  it('draws the curve from 3 points and stretches it over what the history really covers', () => {
    const H = 3_600_000;
    const B = 15 * 60_000;
    expect(hasEnoughHistory([{ ts: 0 }, { ts: B }])).toBe(false);
    expect(hasEnoughHistory([{ ts: 0 }, { ts: B }, { ts: 2 * B }])).toBe(true);
    // an old panel: the window is 24 h; a young one (2 h of data) starts at its first sample
    const end = 100 * H;
    expect(chartStart([{ ts: 10 * H }], B, end, 24)).toBe(76 * H);
    expect(chartStart([{ ts: 98 * H }, { ts: 98 * H + B }], B, end, 24)).toBe(98 * H - B);
    expect(chartStart([], B, end, 24)).toBe(76 * H);
  });
  it('cuts markdown out of the news teaser', () => {
    expect(excerptOf({ payload: { content: '', mention: 'none', embed: { description: '**Bold** [link](http://x) text' } } })).toBe('Bold link text');
  });
});
