// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let slow: { resolve: () => void } | null = null;
const entry = (id: string, kind: string, text: string) => ({ id, ts: Date.now() - 60_000, kind, serverId: 1, serverName: 'Alpha', text, status: 'delivered', error: '', by: 'admin' });
vi.mock('../src/api', async (orig) => ({
  ...(await orig<typeof import('../src/api')>()),
  api: vi.fn(async (path: string) => {
    calls.push(path);
    if (path.includes('kind=message') && slow) await new Promise<void>((r) => { slow!.resolve = r; });
    if (path.includes('kind=all')) return { items: [entry('a', 'message', 'all-kinds entry')] };
    if (path.includes('kind=message')) return { items: [entry('m', 'message', 'a message entry')] };
    if (path.includes('kind=auto')) return { items: [entry('r', 'auto', 'an automatic entry')] };
    return { items: [] };
  }),
}));

const { JournalTab } = await import('../src/pages/GameNewsJournal');

beforeEach(() => { calls.length = 0; slow = null; });
afterEach(() => cleanup());

describe('the journal of the plugin', () => {
  it('shows the entries of a tab at once after it is picked (the list does not wait for the next poll)', async () => {
    render(<JournalTab onReuse={() => undefined} onPlayer={() => undefined} />);
    expect(await screen.findByText('all-kinds entry')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Авто|Auto|Правил/i }));
    expect(await screen.findByText('an automatic entry', undefined, { timeout: 2000 })).toBeTruthy();
    expect(calls.some((c) => c.includes('kind=auto'))).toBe(true);
  });

  it('drops the late answer of a tab that was left', async () => {
    slow = { resolve: () => undefined };
    render(<JournalTab onReuse={() => undefined} onPlayer={() => undefined} />);
    await screen.findByText('all-kinds entry');
    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[1]); // «messages»: its answer is held back
    await waitFor(() => expect(calls.some((c) => c.includes('kind=message'))).toBe(true));
    fireEvent.click(tabs[2]); // another tab before the held one answers
    expect(await screen.findByText('an automatic entry', undefined, { timeout: 2000 })).toBeTruthy();
    slow.resolve();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('a message entry')).toBeNull();
    expect(screen.getByText('an automatic entry')).toBeTruthy();
  });
});
