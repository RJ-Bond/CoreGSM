// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StatusPage from '../src/pages/Status';
import { lasted } from '../src/pages/Incident';

const START = 1_700_000_000_000;
vi.mock('../src/api', async (orig) => ({
  ...(await orig<typeof import('../src/api')>()),
  api: vi.fn(async (path: string) => {
    if (path !== `/status/incidents/3/${START}`) throw new Error('Сбой не найден');
    return {
      incident: { serverId: 3, serverName: 'Alpha', game: 'rust', start: START, end: START + 4_500_000, minutes: 75, playersBefore: 12, planned: false },
      timeline: [
        { ts: START, kind: 'down', playersBefore: 12, planned: false },
        { ts: START + 600_000, kind: 'note', title: 'Looking for the cause', body: 'A disk', level: 'warn' },
        { ts: START + 4_500_000, kind: 'up', minutes: 75 },
      ],
      points: [{ ts: START - 60_000, online: true, players: 12 }, { ts: START, online: false, players: 0 }, { ts: START + 4_500_000, online: true, players: 3 }],
    };
  }),
}));

afterEach(cleanup);

describe('the page of one outage', () => {
  it('tells the story in order, with a chart and the link to the server', async () => {
    const { container } = render(<StatusPage sub={`incident/3/${START}`} />);
    expect(await screen.findByText('Looking for the cause')).toBeTruthy();
    expect(container.querySelectorAll('ol li').length).toBe(3);
    expect(container.querySelectorAll('svg[role="img"] rect').length).toBe(3);
    expect(container.querySelector('a[href="/servers/3"]')).toBeTruthy();
    expect(container.querySelector('a[href="/status"]')).toBeTruthy();
  });
  it('says so when there is no such outage', async () => {
    render(<StatusPage sub="incident/3/5" />);
    expect(await screen.findByText(/Сбой не найден/)).toBeTruthy();
  });
  it('writes a duration in hours and minutes', () => {
    expect(lasted(75)).toContain('1');
    expect(lasted(75)).toContain('15');
    expect(lasted(0)).toContain('1');
  });
});
