// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupHome } from '../src/components/servers/homeLogic';
import { DownStrip, HeroRow, QuietList } from '../src/components/servers/HomeGroups';
import type { Server } from '../src/api';

vi.mock('../src/auth', () => ({ useAuth: () => ({ isAdmin: false, me: null }) }));
vi.mock('../src/components/servers/QuickMenu', () => ({ QuickMenu: () => null }));
afterEach(cleanup);

const server = (id: number, over: Partial<Server> = {}): Server => ({
  id, name: `Server ${id}`, customName: '', nameAuto: true, game: 'rust', host: '203.0.113.1', port: 28015, queryPort: null, displayAddress: '', country: '',
  coverUrl: null, address: '203.0.113.1:28015', hasStatus: true, online: true, players: 5, maxPlayers: 40, map: null, version: null, ping: 40,
  playerNames: [], error: null, updatedAt: Date.now(), ...over,
});

describe('which servers get a card on the home page', () => {
  const list = [server(1), server(2, { online: false, players: 0 }), server(3, { players: 0 }), server(4, { players: 0 }), server(5, { online: false, maintenance: { name: 'work', until: null } }), server(6, { hasStatus: false, online: false })];
  it('names the silent ones in the strip and puts the empty ones in the compact list', () => {
    const g = groupHome(list, [4], true, true);
    expect(g.down.map((s) => s.id)).toEqual([2]);
    expect(g.quiet.map((s) => s.id)).toEqual([3]);
    // a favourite, one in maintenance and one never asked keep their cards
    expect(g.cards.map((s) => s.id)).toEqual([1, 4, 5, 6]);
  });
  it('keeps every card under a filter, in the selection mode and when nobody is online', () => {
    expect(groupHome(list, [], false, true).cards).toHaveLength(6);
    expect(groupHome(list, [], true, false).cards).toHaveLength(6);
  });
});

describe('the lines of the home page', () => {
  it('says which server does not answer and for how long, without staff buttons for a guest', () => {
    render(<DownStrip servers={[server(2, { online: false })]} since={new Map([[2, Date.now() - 7_200_000]])} />);
    expect(screen.getByText(/не отвечает 2/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: 'Server 2' }).getAttribute('href')).toBe('/servers/2');
  });
  it('lists the empty ones with their places', () => {
    render(<QuietList servers={[server(3, { players: 0, maxPlayers: 16 })]} />);
    expect(screen.getByText('0/16')).toBeTruthy();
  });
  it('draws nothing when there is nothing to say', () => {
    const { container } = render(<><DownStrip servers={[]} since={new Map()} /><QuietList servers={[]} /></>);
    expect(container.textContent).toBe('');
  });
  it('gives the big server of a phone one row with the count and the way in', () => {
    render(<HeroRow s={server(1, { players: 12 })} label="Busiest" />);
    expect(screen.getByRole('link', { name: 'Server 1' }).getAttribute('href')).toBe('/servers/1');
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Играть' }).getAttribute('href')).toContain('steam://connect/');
  });
});
