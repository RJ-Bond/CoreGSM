import { describe, expect, it } from 'vitest';
import type { Server } from '../../api';
import { nextUsualPeak, pickHeroBy } from './heroLogic';

// a baseline whose value at an hour is its UTC hour of the day, every day: it grows from 0 to 23
const ramp = Array.from({ length: 168 }, (_, i) => i % 24);
const at = (utcHour: number) => Date.UTC(2026, 10, 12, utcHour, 20);

const srv = (id: number, players: number, max: number, over: Partial<Server> = {}): Server => ({
  id, name: `S${id}`, customName: '', nameAuto: true, game: 'rust', host: 'h', port: 1, queryPort: null, displayAddress: '', country: '', coverUrl: null, address: 'h:1',
  hasStatus: true, online: true, players, maxPlayers: max, map: null, version: null, ping: 30, playerNames: [], error: null, updatedAt: 1, ...over,
});

describe('the usual peak of the next hours', () => {
  it('finds the busiest hour ahead and says how far it is', () => {
    const p = nextUsualPeak(ramp, at(10));
    expect(p).toMatchObject({ hoursAhead: 11, value: 21, now: false });
    expect(p?.at).toBe(Date.UTC(2026, 10, 12, 21, 0));
  });
  it('says «now» when the current hour is the busiest of the window', () => {
    const falling = ramp.map((_, i) => 23 - (i % 24));
    expect(nextUsualPeak(falling, at(5))?.now).toBe(true);
  });
  it('says nothing for a flat, empty or missing baseline', () => {
    expect(nextUsualPeak(Array(168).fill(5), at(8))).toBeNull();
    expect(nextUsualPeak(Array(168).fill(0), at(8))).toBeNull();
    expect(nextUsualPeak(null, at(8))).toBeNull();
    expect(nextUsualPeak([1, 2], at(8))).toBeNull();
  });
});

describe('the server of the big card by the chosen mode', () => {
  const list = [srv(1, 40, 100), srv(2, 20, 25), srv(3, 5, 10)];
  it('busiest keeps the old choice, fullest takes the fullest by places, favourite the favourite with most players', () => {
    expect(pickHeroBy(list, [], 'busiest')?.server.id).toBe(1);
    expect(pickHeroBy(list, [], 'fullest')?.server.id).toBe(2);
    expect(pickHeroBy(list, [3], 'favourite')?.server.id).toBe(3);
    expect(pickHeroBy(list, [], 'favourite')?.server.id).toBe(1);
  });
  it('a server with a problem is not chosen unless every server has one', () => {
    const bad = [srv(1, 0, 10, { online: false }), srv(2, 3, 10)];
    expect(pickHeroBy(bad, [], 'fullest')?.server.id).toBe(2);
    expect(pickHeroBy([bad[0]], [], 'fullest')?.reason).toBe('attention');
  });
});
