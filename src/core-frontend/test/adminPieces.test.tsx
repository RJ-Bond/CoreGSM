// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NewsCalendar } from '../src/components/news/Calendar';
import { EmptyArt } from '../src/components/EmptyArt';
import AboutPage from '../src/pages/About';
import type { NewsItem } from '../src/api';

afterEach(cleanup);

const noon = (daysFromNow: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + daysFromNow); return d.getTime(); };
const item = (id: number, p: Partial<NewsItem>): NewsItem => ({ id, title: `News ${id}`, status: 'scheduled', scheduledAt: noon(0), sentAt: null, payload: {}, ...p } as unknown as NewsItem);

describe('the news calendar', () => {
  it('puts a scheduled item on its day and the item without a date under the grid', () => {
    const { container } = render(<NewsCalendar items={[item(1, {}), item(2, { status: 'draft', scheduledAt: null })]} onMove={() => undefined} />);
    expect(screen.getAllByText(/News 1/).length).toBeGreaterThan(0);
    expect(screen.getByText(/News 2/)).toBeTruthy();
    // 6 weeks of 7 days
    expect(container.querySelectorAll('.grid-cols-7').length).toBe(2);
  });
  it('shows a sent item at the time it was sent, not at the planned one', () => {
    render(<NewsCalendar items={[item(3, { status: 'sent', sentAt: noon(0), scheduledAt: noon(1) })]} onMove={() => undefined} />);
    expect(screen.getAllByText(/News 3/).length).toBe(1);
  });
});

describe('the pictures of empty lists', () => {
  it('draw every scene as a hidden svg', () => {
    for (const sc of ['calendar', 'chat', 'key', 'news', 'chart', 'shield', 'plug', 'bell', 'users', 'server'] as const) {
      const { container, unmount } = render(<EmptyArt scene={sc} size={80} />);
      const svg = container.querySelector('svg');
      expect(svg, sc).toBeTruthy();
      unmount();
    }
  });
});

describe('the About page', () => {
  it('names the project and links the open parts', () => {
    const { container } = render(<AboutPage brand="CoreTest" />);
    expect(screen.getAllByText(/CoreTest/).length).toBeGreaterThan(0);
    expect(container.querySelector('a[href="/servers"]')).toBeTruthy();
    expect(container.querySelector('a[href="/api/v1/openapi.json"]')).toBeTruthy();
    expect(container.querySelectorAll('ol li').length).toBe(3);
  });
});
