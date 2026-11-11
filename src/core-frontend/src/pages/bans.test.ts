import { describe, expect, it } from 'vitest';
import { filterBans, leftText, type PublicBan } from './Bans';

const ban = (o: Partial<PublicBan>): PublicBan => ({ nick: 'Alpha', reason: 'cheats', serverId: 1, server: 'S1', scope: 'all', createdAt: 1, until: 0, ...o });

describe('the page of bans', () => {
  it('says what is left of a ban in minutes, hours or days', () => {
    const now = 1_000_000_000;
    expect(leftText(now + 30_000, now)).toContain('1');
    expect(leftText(now + 20 * 60_000, now)).toContain('20');
    expect(leftText(now + 5 * 3_600_000, now)).toContain('5');
    expect(leftText(now + 4 * 86_400_000, now)).toContain('4');
    expect(leftText(now - 5, now)).toContain('1');
  });

  it('filters by a server (a ban of all servers holds on every one) and by a piece of the nickname or the reason', () => {
    const list = [ban({}), ban({ nick: 'Beta', reason: 'Insults', scope: 'server', serverId: 2 }), ban({ nick: 'Gamma', scope: 'server', serverId: 3 })];
    expect(filterBans(list, 0, '').length).toBe(3);
    expect(filterBans(list, 2, '').map((b) => b.nick)).toEqual(['Alpha', 'Beta']);
    expect(filterBans(list, 0, ' insult ').map((b) => b.nick)).toEqual(['Beta']);
    expect(filterBans(list, 0, 'GAM').map((b) => b.nick)).toEqual(['Gamma']);
  });
});
