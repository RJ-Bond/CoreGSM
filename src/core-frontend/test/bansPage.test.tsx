// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '../src/auth';

const answers: Record<string, unknown> = {};
const calls: { path: string; method: string; body: unknown }[] = [];
vi.mock('../src/api', async (orig) => ({
  ...(await orig<typeof import('../src/api')>()),
  api: vi.fn(async (path: string, method = 'GET', body?: unknown) => {
    calls.push({ path, method, body });
    const key = Object.keys(answers).filter((k) => path.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (key === undefined) throw new Error(`no answer for ${path}`);
    return answers[key];
  }),
}));

const { BansView } = await import('../src/pages/Bans');
const { default: PlayerWelcome } = await import('../src/components/PlayerWelcome');

function withAuth(ui: ReactNode, me: unknown) {
  const base = {
    me, isAdmin: false, isStaff: false, reload: async () => undefined, logout: () => undefined,
    access: { publicPanel: true, registration: true, registrationMode: 'open', rules: '', discordLogin: false, brand: { name: 'CoreGSM', color: '#4f46e5', hasLogo: false } },
  } as unknown as AuthState;
  return <AuthContext.Provider value={base}>{ui}</AuthContext.Provider>;
}

const ban = { nick: 'Cheater', reason: 'aimbot', serverId: 1, server: 'Alpha', scope: 'all', createdAt: Date.now() - 60_000, until: 0 };

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
  answers['/bans/history'] = { items: [{ kind: 'unban', nick: 'Forgiven', reason: '', serverId: 0, server: '', at: Date.now() - 5000, until: 0, expired: false }] };
  answers['/bans/appeals'] = [{ id: 7, at: Date.now() - 9000, nick: 'Cheater', platformId: 'p1', text: 'I did nothing wrong, check the log', contact: 'me@x', status: 'open', note: '', decidedBy: null, decidedAt: null }];
  answers['/bans/alerts'] = { on: false };
  answers['/bans'] = { total: 1, forever: 1, last7d: 1, servers: [{ id: 1, name: 'Alpha', count: 1 }], items: [ban] };
});
afterEach(() => cleanup());

describe('the bans view', () => {
  it('lists the bans in force and shows the history in its tab', async () => {
    render(withAuth(<BansView />, null));
    expect((await screen.findAllByText('Cheater')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Заявки' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'История' }));
    expect(await screen.findByText('Forgiven')).toBeTruthy();
  });

  it('takes an appeal from anyone with the form at the bottom', async () => {
    render(withAuth(<BansView />, null));
    await screen.findAllByText('Cheater');
    fireEvent.click(screen.getByRole('button', { name: /Вас заблокировали/ }));
    fireEvent.change(screen.getByLabelText('Ник в игре'), { target: { value: 'Cheater' } });
    fireEvent.change(screen.getByLabelText('Что произошло и почему бан стоит снять'), { target: { value: 'It was a mistake, please look again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/bans/appeals' && c.method === 'POST')).toBe(true));
    const sent = calls.find((c) => c.path === '/bans/appeals' && c.method === 'POST');
    expect(sent?.body).toMatchObject({ nick: 'Cheater' });
    expect(await screen.findByText(/Заявка отправлена/)).toBeTruthy();
  });

  it('gives the staff the tab of the appeals and the decision that lifts the ban', async () => {
    render(withAuth(<BansView />, { id: 1, username: 'mod', role: 'moderator' }));
    await screen.findAllByText('Cheater');
    fireEvent.click(screen.getByRole('button', { name: 'Заявки' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Принять и снять бан' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/bans/appeals/7' && c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.path === '/bans/appeals/7')?.body).toEqual({ status: 'accepted', unban: true });
  });
});

describe('the hints for a new player', () => {
  it('show once to a player and never again after they are closed, and never to the staff', () => {
    const { unmount } = render(withAuth(<PlayerWelcome />, { id: 2, username: 'newbie', role: 'player' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    render(withAuth(<PlayerWelcome />, { id: 2, username: 'newbie', role: 'player' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    render(withAuth(<PlayerWelcome />, { id: 3, username: 'boss', role: 'admin' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
