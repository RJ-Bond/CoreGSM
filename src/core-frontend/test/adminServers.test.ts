import { describe, expect, it } from 'vitest';
import type { Server } from '../src/api';
import { countServers, filterServers, isProblem } from '../src/pages/adminServersLogic';

const srv = (id: number, o: Partial<Server> = {}): Server => ({
  id, name: `S${id}`, customName: '', nameAuto: false, game: 'rust', host: `h${id}.example.com`, port: 28015, queryPort: null, displayAddress: '', country: '', coverUrl: null,
  address: `h${id}:1`, hasStatus: true, online: true, players: 0, maxPlayers: 20, map: null, version: null, ping: 20, playerNames: [], error: null, updatedAt: 0, maintenance: null, ...o,
}) as Server;

describe('admin servers table', () => {
  const list = [srv(1, { name: 'Empire Bay', game: 'm2o' }), srv(2, { online: false }), srv(3, { ping: 300 }), srv(4, { online: false, maintenance: { name: 'x', until: null } }), srv(5, { online: false, hasStatus: false })];

  it('a problem is an unanswered or slow server, not one in maintenance and not one that never answered', () => {
    expect(list.map(isProblem)).toEqual([false, true, true, false, false]);
  });
  it('filters by status', () => {
    expect(filterServers(list, 'all', '').length).toBe(5);
    expect(filterServers(list, 'online', '').map((s) => s.id)).toEqual([1, 3]);
    expect(filterServers(list, 'problems', '').map((s) => s.id)).toEqual([2, 3]);
  });
  it('searches the name, the game, the host and the port, ignoring case and spaces around', () => {
    expect(filterServers(list, 'all', '  empire ').map((s) => s.id)).toEqual([1]);
    expect(filterServers(list, 'all', 'M2O').map((s) => s.id)).toEqual([1]);
    expect(filterServers(list, 'all', 'h3.').map((s) => s.id)).toEqual([3]);
    expect(filterServers(list, 'all', '28015').length).toBe(5);
    expect(filterServers(list, 'problems', 'h3').map((s) => s.id)).toEqual([3]);
    expect(filterServers(list, 'all', 'nothing-like-this')).toEqual([]);
  });
  it('counts for the filter chips', () => {
    expect(countServers(list)).toEqual({ all: 5, online: 2, problems: 2 });
    expect(countServers([])).toEqual({ all: 0, online: 0, problems: 0 });
  });
});
