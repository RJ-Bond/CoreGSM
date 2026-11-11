// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { readPaletteRecent, readRecentServers, rememberPaletteRecent, rememberServer } from './recent';

describe('the servers opened last', () => {
  beforeEach(() => localStorage.clear());

  it('puts the newest first, keeps three and moves a server that is opened again to the front', () => {
    expect(readRecentServers()).toEqual([]);
    rememberServer({ id: 1, name: 'A', game: 'rust' });
    rememberServer({ id: 2, name: 'B', game: 'rust' });
    rememberServer({ id: 3, name: 'C', game: 'rust' });
    rememberServer({ id: 4, name: 'D', game: 'rust' });
    expect(readRecentServers().map((s) => s.id)).toEqual([4, 3, 2]);
    rememberServer({ id: 2, name: 'B2', game: 'rust' });
    expect(readRecentServers().map((s) => `${s.id}:${s.name}`)).toEqual(['2:B2', '4:D', '3:C']);
  });

  it('does not trust what the storage holds', () => {
    localStorage.setItem('coregsm_recent_servers', '{"not":"a list"}');
    expect(readRecentServers()).toEqual([]);
    localStorage.setItem('coregsm_recent_servers', JSON.stringify([{ id: 'x', name: 1 }, { id: 5, name: 'ok', game: 'm2o' }]));
    expect(readRecentServers().map((s) => s.id)).toEqual([5]);
    localStorage.setItem('coregsm_recent_servers', 'not json');
    expect(readRecentServers()).toEqual([]);
  });
});

describe('the keys of the command palette', () => {
  beforeEach(() => localStorage.clear());

  it('keeps five, newest first, without repeats', () => {
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'c']) rememberPaletteRecent(k);
    expect(readPaletteRecent()).toEqual(['c', 'f', 'e', 'd', 'b']);
  });
});
