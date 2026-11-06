import { describe, expect, it } from 'vitest';
import { eventFacts, whenShort } from './serverLogic';

describe('whenShort', () => {
  const now = new Date(2026, 10, 5, 12, 0).getTime();
  it('says today and yesterday, else the date', () => {
    expect(whenShort(new Date(2026, 10, 5, 8, 30).getTime(), now)).toMatch(/08:30/);
    expect(whenShort(new Date(2026, 10, 4, 19, 38).getTime(), now)).toMatch(/19:38/);
    expect(whenShort(new Date(2026, 10, 4, 19, 38).getTime(), now)).not.toBe(whenShort(new Date(2026, 10, 1, 19, 38).getTime(), now));
    expect(whenShort(new Date(2026, 9, 20, 7, 5).getTime(), now)).toMatch(/07:05/);
  });
});

describe('eventFacts', () => {
  it('counts the outages and finds the latest', () => {
    expect(eventFacts([{ ts: 5, type: 'down' }, { ts: 9, type: 'up' }, { ts: 20, type: 'down' }, { ts: 3, type: 'peak' }])).toEqual({ downs: 2, lastDown: 20 });
    expect(eventFacts([{ ts: 1, type: 'peak' }])).toEqual({ downs: 0, lastDown: null });
  });
});
