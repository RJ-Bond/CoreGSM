// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from '../src/api';
import { AuthContext, type AuthState } from '../src/auth';

// The data of the page comes from the API: the test answers each path with a small fixed set of servers.
const answers: Record<string, unknown> = {};
vi.mock('../src/api', async (orig) => ({
  ...(await orig<typeof import('../src/api')>()),
  api: vi.fn(async (path: string) => {
    // the most specific path wins: '/servers/2/details' is not '/servers'
    const key = Object.keys(answers).filter((k) => path.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (key === undefined) throw new Error(`no answer for ${path}`);
    return answers[key];
  }),
}));

const { default: ServersPage } = await import('../src/pages/Servers');

const server = (id: number, name: string, over: Partial<Server> = {}): Server => ({
  id, name, customName: '', nameAuto: true, game: 'rust', host: `10.0.0.${id}`, port: 28015, queryPort: null, displayAddress: '', country: '',
  coverUrl: null, address: `10.0.0.${id}:28015`, hasStatus: true, online: true, players: 5, maxPlayers: 40, map: null, version: null, ping: 40,
  playerNames: [], error: null, updatedAt: Date.now(), ...over,
});

const LONG = '[RU] Just-Skill.Ru | Standart PvE with a very long title';

function withAuth(ui: ReactNode, me: AuthState['me']) {
  const base = {
    me, isAdmin: false, isStaff: false, reload: async () => undefined, logout: () => undefined,
    access: { publicPanel: true, registration: true, registrationMode: 'open', rules: '', discordLogin: false, brand: { name: 'CoreGSM', color: '#4f46e5', hasLogo: false } },
  } as unknown as AuthState;
  return <AuthContext.Provider value={base}>{ui}</AuthContext.Provider>;
}

beforeEach(() => {
  // anything the page reads with a plain fetch gets an empty answer instead of a refused connection
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
  localStorage.clear();
  window.history.replaceState(null, '', '/servers');
  for (const k of Object.keys(answers)) delete answers[k];
  answers['/servers'] = [server(1, 'Rust | Vanilla x2', { players: 52, maxPlayers: 100 }), server(2, LONG), server(3, 'Terraria', { online: false, players: 0 })];
  answers['/status'] = { updatedAt: Date.now(), range: 30, notes: [], incidents: [], servers: [] };
  answers['/favorites'] = [];
  answers['/servers/2/probes'] = { probes: [] };
  answers['/overview'] = { points: [], totals: { players: 0 }, maintenance: [] };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Servers page', () => {
  it('lists every server by its full name', async () => {
    render(withAuth(<ServersPage sub="" />, null));
    // the long name is in the page as one piece of text (the CSS wraps it, nothing cuts it in the markup)
    expect((await screen.findAllByText(LONG)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Terraria').length).toBeGreaterThan(0);
  });

  it('long names are never made single-line headings (they wrap to a second line instead of being cut off)', async () => {
    render(withAuth(<ServersPage sub="" />, null));
    await screen.findAllByText(LONG);
    for (const el of screen.getAllByText(LONG)) {
      const heading = el.closest('h3');
      if (heading) expect(heading.className).not.toMatch(/\btruncate\b/);
    }
  });

  it('a remembered «Favourites» filter with nothing starred falls back to all the servers', async () => {
    localStorage.setItem('coregsm_server_filter', 'fav');
    const me = { id: 1, username: 'u', role: 'user' } as unknown as AuthState['me'];
    render(withAuth(<ServersPage sub="" />, me));
    expect((await screen.findAllByText(LONG)).length).toBeGreaterThan(0);
    await waitFor(() => expect(localStorage.getItem('coregsm_server_filter')).toBe('all'));
    expect(screen.queryByText(/пока пусто/i)).toBeNull();
  });

  it('a favourite that exists keeps the «Favourites» filter', async () => {
    localStorage.setItem('coregsm_server_filter', 'fav');
    answers['/favorites'] = [1];
    const me = { id: 1, username: 'u', role: 'user' } as unknown as AuthState['me'];
    render(withAuth(<ServersPage sub="" />, me));
    await waitFor(() => expect(screen.getAllByText('Rust | Vanilla x2').length).toBeGreaterThan(0));
    expect(localStorage.getItem('coregsm_server_filter')).toBe('fav');
    expect(screen.queryByText(LONG)).toBeNull();
  });
});

describe('Server page', () => {
  const details = (over: Partial<Server> = {}) => ({
    server: { ...server(2, LONG), ...over, countryCode: 'RU' },
    hours: 24,
    points: Array.from({ length: 12 }, (_, i) => ({ ts: Date.now() - (12 - i) * 3600_000, players: 5 + i, online: 1, ping: 40 })),
    stats: { samples: 12, uptimePct: 99.9, avgPlayers: 9, peakPlayers: 16, peakAt: Date.now() - 3600_000 },
    events: [],
    baseline: null,
    playersNow: [{ name: 'Alice', since: Date.now() - 600_000 }, { name: 'Bob', since: Date.now() - 6_000_000 }],
  });

  it('shows the full name of the server, its address and who is playing', async () => {
    answers['/servers/2/details'] = details();
    render(withAuth(<ServersPage sub="2" />, null));
    expect((await screen.findAllByText(LONG)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0);
  });

  it('a server nobody is on and that does not answer still renders', async () => {
    answers['/servers/2/details'] = { ...details({ online: false, players: 0, hasStatus: true }), playersNow: [], points: [], events: [] };
    render(withAuth(<ServersPage sub="2" />, null));
    expect((await screen.findAllByText(LONG)).length).toBeGreaterThan(0);
  });

  it('an unknown tab or a word instead of a number is the «not found» page, not a crash', () => {
    const { container } = render(withAuth(<ServersPage sub="abc" />, null));
    expect(container.textContent).not.toContain(LONG);
    expect(container.textContent?.length).toBeGreaterThan(0);
  });
});
