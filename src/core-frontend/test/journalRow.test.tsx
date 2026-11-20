// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const NOW = Date.now();
const items = [
  { id: 'm1', ts: NOW - 60_000, kind: 'message', serverId: 1, serverName: 'Alpha', text: 'Привет всем', status: 'delivered', error: '', by: 'admin', deliveredAt: NOW - 58_500, shown: 14 },
  { id: 'm2', ts: NOW - 120_000, kind: 'auto', serverId: 1, serverName: 'Alpha', text: 'Тех.работы', status: 'expired', error: 'Плагин не забрал сообщение за 5 минут', by: 'авто: Тех.работы', deliveredAt: null, shown: null },
  { id: 'p1', ts: NOW - 180_000, kind: 'plugin', serverId: 1, serverName: 'Alpha', text: 'ЗАМИРАНИЕ 6.2 с', status: 'freeze', error: '', by: '' },
];
vi.mock('../src/api', async (orig) => ({
  ...(await orig<typeof import('../src/api')>()),
  api: vi.fn(async (path: string, method?: string) => {
    calls.push(`${method ?? 'GET'} ${path}`);
    if (path.includes('around=')) return { items: [{ id: 'x1', ts: NOW - 119_000, kind: 'plugin', serverId: 1, serverName: 'Alpha', text: 'Рядом было замирание', status: 'freeze', error: '', by: '' }] };
    if (path.startsWith('/game-news/journal')) return { items, counts: { all: 3, problems: 2, message: 1, auto: 1, plugin: 1 }, retentionDays: 30 };
    if (path === '/game-news') return { servers: [{ id: 1, name: 'Alpha', game: 'vrising', hasToken: true }, { id: 2, name: 'Beta', game: 'rust', hasToken: true }] };
    return {};
  }),
}));

const { JournalTab } = await import('../src/pages/GameNewsJournal');

beforeEach(() => { calls.length = 0; });
afterEach(() => cleanup());

describe('a row of the journal', () => {
  it('shows who sent it, the status and how many players saw it; the problems get a tab with a count', async () => {
    render(<JournalTab onReuse={() => undefined} onPlayer={() => undefined} />);
    expect(await screen.findByText(/увидели: 14|seen by: 14/)).toBeTruthy();
    expect(screen.getByText('Тех.работы → Alpha')).toBeTruthy();
    const problems = screen.getByRole('tab', { name: /Проблемы|Problems/ });
    expect(problems.textContent).toContain('2');
  });

  it('opens: the preview, the advice for the error, and what was around it', async () => {
    render(<JournalTab onReuse={() => undefined} onPlayer={() => undefined} />);
    await screen.findByText('Тех.работы → Alpha');
    fireEvent.click(screen.getByText('Тех.работы → Alpha'));
    expect(screen.getByText(/Сервер выключен или плагин потерял связь|The server is off or the plugin lost/)).toBeTruthy();
    expect(screen.getByText(/Так увидят в игре|How it looks in the game/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Что было рядом|What was around/ }));
    expect(await screen.findByText('Рядом было замирание')).toBeTruthy();
    expect(calls.some((c) => c.includes('around='))).toBe(true);
  });

  it('shows the days of the journal and clears the old part on request', async () => {
    render(<JournalTab onReuse={() => undefined} onPlayer={() => undefined} />);
    await screen.findByText('Тех.работы → Alpha');
    fireEvent.click(screen.getByRole('button', { name: /Хранение журнала|Keeping the journal/ }));
    expect(screen.getByRole('button', { name: /Очистить старше 30|Clear older than 30/ })).toBeTruthy();
  });
});
