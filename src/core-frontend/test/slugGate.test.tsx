// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ServersPage from '../src/pages/Servers';

vi.mock('../src/api', async (orig) => ({
  ...(await orig<typeof import('../src/api')>()),
  api: vi.fn(async (path: string) => {
    if (path === '/servers/by-slug/rust-main') return { id: 7 };
    throw new Error('not found');
  }),
}));
vi.mock('../src/pages/ServerDetail', () => ({ default: ({ id, tab }: { id: number; tab: string }) => <p>detail {id} {tab}</p>, SERVER_TABS: ['players', 'connect'] }));

afterEach(cleanup);

describe('a short name of a server in the address', () => {
  it('opens the numbered address of the server, keeping the tab', async () => {
    window.history.replaceState(null, '', '/servers/rust-main/connect');
    render(<ServersPage sub="rust-main/connect" />);
    await waitFor(() => expect(window.location.pathname).toBe('/servers/7/connect'));
  });
  it('says there is no such server for an unknown name', async () => {
    window.history.replaceState(null, '', '/servers/nothing-here');
    const { container } = render(<ServersPage sub="nothing-here" />);
    expect(container.querySelector('[aria-busy]')).toBeTruthy();
    await waitFor(() => expect(container.querySelector('[aria-busy]')).toBeNull());
    expect(window.location.pathname).toBe('/servers/nothing-here');
  });
  it('still opens a server by its number', () => {
    render(<ServersPage sub="3/players" />);
    expect(screen.getByText('detail 3 players')).toBeTruthy();
  });
});
