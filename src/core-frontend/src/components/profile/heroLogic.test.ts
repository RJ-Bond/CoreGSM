import { describe, expect, it } from 'vitest';
import type { Achievement, MyRank, Server } from '../../api';
import { lastDaysMarks, nextSecurityStep, pickFocus, rankLevel, securityChecks } from './heroLogic';

const rank = (hours: number, next: { name: string; minHours: number } | null, nick = 'Ren'): MyRank => ({
  game: 'vrising', hours, rank: { id: 'wanderer', name: 'W', minHours: 10, color: '#111', image: '' },
  next: next ? { id: 'hunter', name: next.name, minHours: next.minHours, color: '#f00', image: '' } : null, progress: 0.5, sessions: 3, nick,
});
const ach = (id: string, progress: number, target: number, earned = false): Achievement => ({ id, title: id, description: '', icon: 'star', earned, progress, target, earnedAt: null });
const srv = (id: number, players: number, online = true): Server => ({ id, name: `S${id}`, players, online } as unknown as Server);

describe('rankLevel', () => {
  it('is the place in the ladder', () => {
    expect(rankLevel('awakened')).toEqual({ level: 1, total: 8 });
    expect(rankLevel('wanderer').level).toBe(2);
    expect(rankLevel('progenitor').level).toBe(8);
    expect(rankLevel('nope').level).toBe(1);
  });
});

describe('pickFocus', () => {
  const none = { playing: null, rank: null, achievements: null, favs: null };
  it('nothing to say gives null', () => expect(pickFocus(none)).toBeNull());
  it('being in the game wins over everything', () => {
    const f = pickFocus({ ...none, playing: { name: 'A', serverId: 1, since: 5 }, rank: rank(28, { name: 'H', minHours: 30 }) });
    expect(f).toMatchObject({ kind: 'playing', name: 'A', serverId: 1 });
  });
  it('a rank that is close (5 hours or less) comes next', () => {
    const f = pickFocus({ ...none, rank: rank(28, { name: 'H', minHours: 30 }), achievements: [ach('a', 9, 10)] });
    expect(f).toMatchObject({ kind: 'rank', name: 'H', hoursLeft: 2 });
  });
  it('then an achievement that is almost earned (60 % or more)', () => {
    const f = pickFocus({ ...none, rank: rank(11, { name: 'H', minHours: 30 }), achievements: [ach('far', 1, 10), ach('near', 8, 10), ach('done', 10, 10, true)] });
    expect(f).toMatchObject({ kind: 'ach', id: 'near' });
  });
  it('then the busiest online favourite', () => {
    const f = pickFocus({ ...none, favs: [srv(1, 3), srv(2, 9), srv(3, 20, false)] });
    expect(f).toMatchObject({ kind: 'fav', serverId: 2, players: 9 });
  });
  it('a player without a nick is asked for one, and a nick without visits is told to go play', () => {
    expect(pickFocus({ ...none, nick: '' })).toEqual({ kind: 'setupNick' });
    expect(pickFocus({ ...none, nick: undefined })).toBeNull();
    expect(pickFocus({ ...none, nick: 'Ren', hasPlayed: false })).toEqual({ kind: 'firstGame' });
    expect(pickFocus({ ...none, nick: 'Ren', hasPlayed: true })).toBeNull();
    // being in the game still wins, and a favourite beats the «go play» card
    expect(pickFocus({ ...none, nick: '', playing: { name: 'A', serverId: 1, since: 5 } })).toMatchObject({ kind: 'playing' });
    expect(pickFocus({ ...none, nick: 'Ren', hasPlayed: false, favs: [srv(2, 9)] })).toMatchObject({ kind: 'fav' });
  });

  it('the far rank is the last resort and needs a game nick', () => {
    expect(pickFocus({ ...none, rank: rank(11, { name: 'H', minHours: 30 }) })).toMatchObject({ kind: 'rank', hoursLeft: 19 });
    expect(pickFocus({ ...none, rank: rank(11, { name: 'H', minHours: 30 }, '') })).toBeNull();
    expect(pickFocus({ ...none, rank: rank(2000, null) })).toBeNull();
  });
});

describe('security score', () => {
  const me = { emailVerified: true, hasPassword: true, discordName: null as string | null };
  it('marks what is done and names the first step left', () => {
    const c = securityChecks(me, false);
    expect(c.filter((x) => x.ok)).toHaveLength(2);
    expect(nextSecurityStep(c)).toBe('tfa');
    expect(nextSecurityStep(securityChecks({ ...me, discordName: 'x' }, true))).toBeNull();
    expect(nextSecurityStep(securityChecks({ ...me, emailVerified: false }, true))).toBe('email');
  });
});

describe('lastDaysMarks', () => {
  it('takes the last days and marks the ones with play', () => {
    expect(lastDaysMarks([{ seconds: 0 }, { seconds: 60 }, { seconds: 0 }, { seconds: 5 }], 3)).toEqual([true, false, true]);
    expect(lastDaysMarks([], 14)).toEqual([]);
  });
});
