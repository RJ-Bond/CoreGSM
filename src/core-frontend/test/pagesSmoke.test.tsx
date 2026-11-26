// @vitest-environment happy-dom
/** Every big page, two ways: while the answer is on its way and when the server refuses. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '../src/auth';
import Maintenance from '../src/pages/Maintenance';
import Health from '../src/pages/Health';
import Alerts from '../src/pages/Alerts';
import Journal from '../src/pages/Journal';
import Backups from '../src/pages/Backups';
import Integrations from '../src/pages/AdminIntegrations';
import Overview from '../src/pages/AdminOverview';
import Cards from '../src/pages/Cards';
import System from '../src/pages/System';
import News from '../src/pages/News';
import { UsersTab } from '../src/pages/settings/UsersTab';
import Bans from '../src/pages/Bans';
import Status from '../src/pages/Status';
import Community from '../src/pages/Community';

let mode: 'pending' | 'error' = 'pending';
vi.mock('../src/api', async (orig) => ({
  ...(await orig<typeof import('../src/api')>()),
  api: vi.fn(() => (mode === 'pending' ? new Promise(() => undefined) : Promise.reject(new Error('SMOKE-REFUSED')))),
}));

const auth = {
  me: { id: 1, username: 'admin', role: 'admin', perms: [] }, isAdmin: true, isStaff: true, reload: async () => undefined, logout: () => undefined,
  access: { publicPanel: true, registration: true, registrationMode: 'open', rules: '', discordLogin: false, brand: { name: 'CoreGSM', color: '#4f46e5' } },
} as unknown as AuthState;

const PAGES: [string, ComponentType][] = [
  ['maintenance', Maintenance], ['health', Health], ['alerts', Alerts], ['journal', Journal], ['backups', Backups], ['integrations', Integrations],
  ['overview', Overview], ['cards', Cards], ['system', System], ['news', () => <News sub="" />], ['users', UsersTab], ['bans', Bans],
  ['status', () => <Status />], ['community', Community],
];

const errors: unknown[] = [];
beforeEach(() => {
  errors.length = 0;
  vi.stubGlobal('fetch', vi.fn(() => (mode === 'pending' ? new Promise(() => undefined) : Promise.reject(new Error('SMOKE-REFUSED')))));
  vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a[0]); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

const show = (Page: ComponentType) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthContext.Provider value={auth}><Page /></AuthContext.Provider></QueryClientProvider>,
);

describe.each(PAGES)('the page «%s»', (_name, Page) => {
  it('draws something while the answer is on its way', () => {
    mode = 'pending';
    const { container } = show(Page);
    expect(container.firstElementChild).toBeTruthy();
  });
  it('stays up and says something when the server refuses', async () => {
    mode = 'error';
    const { container } = show(Page);
    // the refusal, or at least words of the page: never a blank screen
    await waitFor(() => expect((container.textContent ?? '').trim().length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 30));
    expect(container.firstElementChild).toBeTruthy();
    const crashed = errors.filter((e) => /Uncaught|The above error occurred|Cannot read propert/i.test(String(e)));
    expect(crashed).toEqual([]);
  });
});
