// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let withData = true;
const point = (i: number) => ({ ts: Date.now() - (5 - i) * 600_000, fps: 28 + i, minFps: 20, worstMs: 800 + i * 100, freezes: i, memMb: 9000 + i * 100, heapMb: 4000, players: 10 });
vi.mock('../src/api', async (orig) => ({
  ...(await orig<typeof import('../src/api')>()),
  api: vi.fn(async (path: string) => {
    calls.push(path);
    if (path === '/game-news') return { servers: [{ id: 1, name: 'Alpha', supported: true, hasToken: true }, { id: 2, name: 'Beta', supported: true, hasToken: true }] };
    if (path.startsWith('/game-news/metrics')) return { points: withData ? [0, 1, 2, 3, 4].map(point) : [] };
    return {};
  }),
}));

const { MetricsSection } = await import('../src/pages/GameNewsMetrics');

beforeEach(() => { calls.length = 0; withData = true; });
afterEach(() => cleanup());

describe('the state of the server from the plugin', () => {
  it('shows the four figures with the last values', async () => {
    render(<MetricsSection />);
    expect(await screen.findByText('32.0')).toBeTruthy(); // fps of the last point
    expect(screen.getAllByText(/9\.18/).length).toBeGreaterThan(0); // 9400 MB in GB
    expect(calls.some((c) => c.includes('metrics?server=1&hours=24'))).toBe(true);
  });

  it('asks for the other server and period when they are picked', async () => {
    render(<MetricsSection />);
    await screen.findByText('32.0');
    fireEvent.change(screen.getByRole('combobox', { name: /Сервер|Server/ }), { target: { value: '2' } });
    await vi.waitFor(() => expect(calls.some((c) => c.includes('metrics?server=2'))).toBe(true));
    fireEvent.click(screen.getAllByRole('button').find((b) => /7 дн|7 days/.test(b.textContent ?? ''))!);
    await vi.waitFor(() => expect(calls.some((c) => c.includes('hours=168'))).toBe(true));
  });

  it('says what is missing when there are no points yet', async () => {
    withData = false;
    render(<MetricsSection />);
    expect(await screen.findByText(/Данных пока нет|No data yet/)).toBeTruthy();
  });
});
