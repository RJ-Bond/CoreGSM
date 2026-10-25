import { describe, expect, it } from 'vitest';
import {
  categoryOf, countByCategory, countdownText, coverGame, coverGradient, filterByCategory, galleryUrls, groupByMonth, groupChanges,
  extractHeadings, isFresh, isGeneratedCover, normCategory, orderFeed, pickHero, relatedNews, toggleReaction, unreadCount, validActions, visibleRubrics, wasEdited,
} from '../src/components/news/newsLogic';
import { blank, fromPayload, toPayload } from '../src/components/news/model';
import type { PublicNews } from '../src/api';

const item = (id: number, sentAt: number | null, extra: Partial<PublicNews> = {}): PublicNews => ({
  id, status: 'sent', title: `n${id}`, payload: { content: '', mention: 'none' }, sentAt, ...extra,
});

describe('news categories', () => {
  it('maps unknown values to announcement', () => {
    expect(normCategory('wipe')).toBe('wipe');
    expect(normCategory('nope')).toBe('announcement');
    expect(normCategory(undefined)).toBe('announcement');
    expect(categoryOf(item(1, 1))).toBe('announcement');
    expect(categoryOf(item(1, 1, { category: 'event' }))).toBe('event');
  });
  it('counts and filters', () => {
    const l = [item(1, 1, { category: 'wipe' }), item(2, 2, { category: 'wipe' }), item(3, 3)];
    const c = countByCategory(l);
    expect(c.all).toBe(3);
    expect(c.wipe).toBe(2);
    expect(c.announcement).toBe(1);
    expect(filterByCategory(l, 'wipe').map((n) => n.id)).toEqual([1, 2]);
    expect(filterByCategory(l, 'all')).toHaveLength(3);
  });
  it('orders pinned first, then newest', () => {
    const l = [item(1, 100), item(2, 300), item(3, 200, { pinned: true })];
    expect(orderFeed(l).map((n) => n.id)).toEqual([3, 2, 1]);
  });
});

describe('countdown', () => {
  const at = 1_000_000_000_000;
  it('shows days, hours and minutes', () => {
    const now = at - ((2 * 24 + 4) * 3600 + 10 * 60 + 5) * 1000;
    expect(countdownText(at, now, 'Вайп')).toBe('Вайп через 2 д 4 ч 10 мин');
    expect(countdownText(at, now, '', 'en')).toBe('In 2 d 4 h 10 min');
  });
  it('shows seconds under an hour and switches to «Началось»', () => {
    expect(countdownText(at, at - 125_000, 'Вайп')).toBe('Вайп через 2 мин 5 с');
    expect(countdownText(at, at)).toBe('Началось');
    expect(countdownText(at, at + 5000, 'Вайп')).toBe('Началось');
  });
});

describe('covers', () => {
  it('uses payload.game, then the first status server, then the category', () => {
    expect(coverGame({ game: 'vrising', statusServerIds: [1], servers: [{ id: 1, game: 'rust' }] })).toBe('vrising');
    expect(coverGame({ statusServerIds: [2, 1], servers: [{ id: 1, game: 'rust' }, { id: 2, game: 'icarus' }] })).toBe('icarus');
    expect(coverGame({ statusServerIds: [9], servers: [] })).toBe('');
    expect(coverGradient({ category: 'wipe' })).toContain('#ea580c');
    expect(coverGradient({ game: 'rust' })).toContain('linear-gradient');
  });
});

describe('grouping, changes, actions, gallery', () => {
  it('groups by month in order of appearance', () => {
    const d = (y: number, m: number) => Date.UTC(y, m, 10);
    const g = groupByMonth([{ sentAt: d(2026, 9) }, { sentAt: d(2026, 9) }, { sentAt: d(2026, 8) }, { sentAt: null }], undefined, true);
    expect(g.map((x) => [x.key, x.items.length])).toEqual([['2026-10', 2], ['2026-09', 1], ['none', 1]]);
  });
  it('orders the changes by kind and drops empty ones', () => {
    const g = groupChanges([{ kind: 'remove', text: 'a' }, { kind: 'add', text: 'b' }, { kind: 'fix', text: ' ' }, { kind: 'add', text: 'c' }]);
    expect(g.map((x) => x.kind)).toEqual(['add', 'remove']);
    expect(g[0].items).toEqual(['b', 'c']);
  });
  it('keeps only https actions, max three', () => {
    const a = validActions([
      { label: 'a', url: 'https://x.io' }, { label: 'b', url: 'http://x.io' }, { label: '', url: 'https://x.io' },
      { label: 'c', url: 'https://y.io' }, { label: 'd', url: 'https://z.io' }, { label: 'e', url: 'https://w.io' },
    ]);
    expect(a.map((x) => x.label)).toEqual(['a', 'c', 'd']);
  });
  it('builds gallery urls', () => {
    expect(galleryUrls([{ upload: 'a.png' }, { url: 'https://i/x.jpg' }, { url: 'javascript:1' }])).toEqual(['/api/news/images/a.png', 'https://i/x.jpg']);
    expect(galleryUrls(undefined)).toEqual([]);
  });
});

describe('reactions', () => {
  it('keeps one reaction per user and toggles off', () => {
    const r1 = toggleReaction([], '🔥');
    expect(r1.next).toBe('🔥');
    expect(r1.list.find((r) => r.emoji === '🔥')).toMatchObject({ count: 1, mine: true });
    const r2 = toggleReaction(r1.list, '👍');
    expect(r2.list.find((r) => r.emoji === '🔥')).toMatchObject({ count: 0, mine: false });
    expect(r2.list.find((r) => r.emoji === '👍')).toMatchObject({ count: 1, mine: true });
    const r3 = toggleReaction(r2.list, '👍');
    expect(r3.next).toBeNull();
    expect(r3.list.every((r) => !r.mine && r.count === 0)).toBe(true);
  });
});

describe('editor model', () => {
  it('round-trips the site fields and stays minimal by default', () => {
    expect(toPayload(blank('1'))).not.toHaveProperty('category');
    const d = blank('1');
    d.category = 'wipe';
    d.pinned = true;
    d.changes = [{ k: 'a', kind: 'fix', text: 'x' }];
    d.actions = [{ k: 'b', label: 'Go', url: 'https://x.io' }];
    d.countdownAt = '2030-01-01T10:00';
    d.countdownLabel = 'Вайп';
    const p = toPayload(d);
    expect(p).toMatchObject({ category: 'wipe', pinned: true, countdownLabel: 'Вайп' });
    const back = fromPayload(p, '1');
    expect(back.category).toBe('wipe');
    expect(back.countdownAt).toBe('2030-01-01T10:00');
    expect(back.actions[0]).toMatchObject({ label: 'Go' });
  });
});

describe('news page helpers', () => {
  it('hides empty rubrics, and the whole row when there is nothing to filter', () => {
    const counts = (o: Partial<Record<string, number>>) => ({ all: 0, announcement: 0, wipe: 0, update: 0, event: 0, maintenance: 0, other: 0, ...o }) as ReturnType<typeof countByCategory>;
    expect(visibleRubrics(counts({ all: 2, announcement: 2 }), 'all')).toEqual([]);
    expect(visibleRubrics(counts({ all: 3, announcement: 2, wipe: 1 }), 'all')).toEqual(['announcement', 'wipe']);
    // the selected rubric stays, even when it became empty, so it can be switched off
    expect(visibleRubrics(counts({ all: 2, announcement: 2 }), 'event')).toEqual(['announcement', 'event']);
  });
  it('a cover is drawn by the panel only without a picture and a game', () => {
    expect(isGeneratedCover({ image: null })).toBe(true);
    expect(isGeneratedCover({ image: '/a.png' })).toBe(false);
    expect(isGeneratedCover({ image: null, game: 'vrising' })).toBe(false);
    expect(isGeneratedCover({ image: null, statusServerIds: [1], servers: [{ id: 1, game: 'icarus' }] })).toBe(false);
    expect(isGeneratedCover({ image: null, statusServerIds: [1], servers: [] })).toBe(true);
  });
  it('lists the headings outside code blocks with their line ids', () => {
    const text = ['intro', '# One', 'text', '```', '# not a heading', '```', '## Two **bold**', '### Three', '#nospace', '# '].join('\n');
    expect(extractHeadings(text)).toEqual([
      { id: 'nw-h-1', level: 1, text: 'One' },
      { id: 'nw-h-6', level: 2, text: 'Two bold' },
      { id: 'nw-h-7', level: 3, text: 'Three' },
    ]);
  });
  it('suggests the same rubric first, then the newest, never the current one', () => {
    const l = [item(1, 10, { category: 'wipe' }), item(2, 30), item(3, 20, { category: 'wipe' }), item(4, 40, { category: 'wipe' }), item(5, 5)];
    expect(relatedNews(l, 1, 'wipe', 3).map((x) => x.id)).toEqual([4, 3, 2]);
    expect(relatedNews(l, 2, 'announcement', 2).map((x) => x.id)).toEqual([5, 4]);
    expect(relatedNews([item(1, 1)], 1, 'wipe')).toEqual([]);
  });
});

describe('news: fresh, hero, edited', () => {
  it('isFresh needs a stored visit and a later publication', () => {
    expect(isFresh(200, 100)).toBe(true);
    expect(isFresh(100, 100)).toBe(false);
    expect(isFresh(200, null)).toBe(false);
    expect(isFresh(null, 100)).toBe(false);
  });
  it('unreadCount counts the fresh ones', () => {
    expect(unreadCount([{ sentAt: 5 }, { sentAt: 50 }, { sentAt: 99 }], 40)).toBe(2);
  });
  it('pickHero: nothing for a short feed, a pinned item first otherwise', () => {
    const mk = (id: number, sentAt: number, pinned = false) => ({ id, sentAt, pinned, payload: { content: '', mention: 'none' as const, ...(pinned ? { pinned: true } : {}) } });
    expect(pickHero([mk(1, 1), mk(2, 2)])).toBeNull();
    expect(pickHero([mk(1, 1, true), mk(2, 5), mk(3, 9)])?.id).toBe(1);
    expect(pickHero([mk(1, 1), mk(2, 5), mk(3, 9)])?.id).toBe(3);
  });
  it('wasEdited ignores quick fixes', () => {
    expect(wasEdited(1000, 1000 + 60_000)).toBe(false);
    expect(wasEdited(1000, 1000 + 3_600_000)).toBe(true);
    expect(wasEdited(null, 5)).toBe(false);
  });
});
