// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playerFacts, playTime } from '../src/pages/profileLogic';
import { validateNews } from '../src/gameNews';
import { t } from '../src/i18n';

const NOW = Date.now();
const conn = (id: number, kind: 'join' | 'leave', ago: number, p: Record<string, unknown> = {}) => ({ id, serverId: 1, serverName: 'Alpha', ts: NOW - ago, kind, platformId: 'p1', nick: 'Carline', reason: kind === 'leave' ? 'LeftGame' : '', removedBy: '', minutes: kind === 'leave' ? 30 : -1, ...p });
const connections = [conn(1, 'join', 7_200_000), conn(2, 'leave', 5_400_000, { minutes: 30 }), conn(3, 'join', 3_600_000), conn(4, 'leave', 1_800_000, { minutes: 30, reason: 'Timeout' }), conn(5, 'leave', 1000, { nick: 'Other' })];
const log = [
  { id: 1, ts: NOW - 86_400_000, kind: 'warn' as const, nick: 'Carline', platformId: 'p1', admin: 'adm', reason: 'спам', serverName: 'Alpha', until: 0 },
  { id: 2, ts: NOW - 80_000_000, kind: 'kick' as const, nick: 'Carline', platformId: 'p1', admin: 'adm', reason: '', serverName: 'Alpha', until: 0 },
  { id: 3, ts: NOW - 70_000_000, kind: 'ban' as const, nick: 'Someone', platformId: 'p9', admin: 'adm', reason: 'читы', serverName: 'Alpha', until: 0 },
];

describe('the facts of a player', () => {
  it('counts the visits, the minutes, the moderation and finds the last seen and the last reason; ignores other players', () => {
    const f = playerFacts('carline', connections, log, []);
    expect(f.visits).toBe(2);
    expect(f.minutes).toBe(60);
    expect(f.warns).toBe(1);
    expect(f.kicks).toBe(1);
    expect(f.bans).toBe(0);
    expect(f.lastReason).toBe('Timeout');
    expect(f.recent.map((c) => c.id)).toEqual([4, 3, 2, 1]);
    expect(playTime(135)).toEqual({ h: 2, m: 15 });
  });
});

describe('the examples of auto announcements', () => {
  it('are valid texts for the game chat', () => {
    for (const id of ['discord', 'restart', 'rules'] as const) {
      expect(validateNews(t(`gn.a.ex.${id}.text` as 'gn.a.ex.discord.text')), id).toBeNull();
    }
  });
});

vi.mock('../src/api', async (orig) => ({
  ...(await orig<typeof import('../src/api')>()),
  api: vi.fn(async (path: string) => {
    if (path.startsWith('/game-news/connections')) return { items: connections };
    if (path.startsWith('/game-news/moderation')) return { bans: [{ platformId: 'p1', masked: 'p1', nick: 'Carline', reason: 'x', admin: 'a', createdAt: NOW, until: 0, kind: 'ban', serverName: 'Alpha' }], log, top: [] };
    if (path === '/game-news/links') return { items: [{ platformId: 'p1', masked: 'p1', nick: 'Carline', username: 'carline_site', status: 'active', discord: true, linkedAt: NOW }] };
    if (path === '/game-news/plugin-alerts') return { silentMin: 10, outdated: true, choices: [0, 5, 10, 30, 60] };
    return {};
  }),
}));

afterEach(() => cleanup());

describe('the card of a player', () => {
  it('shows the account, the ban, the visits and the time', async () => {
    const { PlayerProfile } = await import('../src/pages/GameNewsProfile');
    const filtered: string[] = [];
    render(<PlayerProfile nick="Carline" onClose={() => undefined} onFilter={(n) => filtered.push(n)} />);
    expect(await screen.findByText(/carline_site/)).toBeTruthy();
    expect(screen.getByText(/Забанен|Banned/)).toBeTruthy();
    expect(screen.getByText(/1 ч 0 мин|1 h 0 min/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /История игрока|Player history/ }));
    expect(filtered).toEqual(['Carline']);
  });
});

describe('notifications about the plugin', () => {
  it('shows the saved choices', async () => {
    const { PluginAlertsCard } = await import('../src/pages/GameNewsPluginAlerts');
    render(<PluginAlertsCard />);
    expect(await screen.findByText(/Уведомления о плагине|Plugin notifications/)).toBeTruthy();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('10');
  });
});
