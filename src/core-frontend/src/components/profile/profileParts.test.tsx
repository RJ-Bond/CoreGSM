import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FocusCard } from './FocusCard';
import { SecurityGroup } from './SecurityOverview';
import { DaySpark, StreakStrip } from './statsViz';

describe('FocusCard', () => {
  it('draws nothing without a focus', () => expect(renderToStaticMarkup(<FocusCard focus={null} />)).toBe(''));

  it('links the playing focus to the server and the rank focus to the player tab, with a bar', () => {
    const playing = renderToStaticMarkup(<FocusCard focus={{ kind: 'playing', name: 'Alpha', serverId: 7, since: Date.now() - 60_000 }} />);
    expect(playing).toContain('href="/servers/7"');
    expect(playing).toContain('Alpha');
    expect(playing).not.toContain('pf-bar');
    const rank = renderToStaticMarkup(<FocusCard focus={{ kind: 'rank', name: 'Hunter', color: '#f00', hoursLeft: 2.5, progress: 0.8 }} />);
    expect(rank).toContain('href="/profile/player"');
    expect(rank).toContain('width:80%');
    expect(rank).toContain('Hunter');
  });

  it('shows how far an almost earned achievement is', () => {
    const html = renderToStaticMarkup(<FocusCard focus={{ kind: 'ach', id: 'a', icon: 'star', title: 'Night owl', progress: 8, target: 10 }} />);
    expect(html).toContain('Night owl');
    expect(html).toContain('width:80%');
  });
});

describe('stats pictures', () => {
  it('the curve needs a few days with play, the strip marks the days played', () => {
    expect(renderToStaticMarkup(<DaySpark byDay={[{ seconds: 0 }, { seconds: 0 }, { seconds: 0 }]} />)).toBe('');
    expect(renderToStaticMarkup(<DaySpark byDay={[{ seconds: 1 }, { seconds: 5 }, { seconds: 3 }]} />)).toContain('pf-spark-line');
    const strip = renderToStaticMarkup(<StreakStrip byDay={[{ seconds: 0 }, { seconds: 9 }, { seconds: 9 }]} days={14} />);
    expect((strip.match(/is-on/g) ?? []).length).toBe(2);
    expect((strip.match(/<i/g) ?? []).length).toBe(3);
  });
});

describe('SecurityGroup', () => {
  it('is a folding block: open when asked, closed otherwise', () => {
    expect(renderToStaticMarkup(<SecurityGroup title="A" defaultOpen><p>x</p></SecurityGroup>)).toContain('<details class="pf-group" open');
    expect(renderToStaticMarkup(<SecurityGroup title="B"><p>x</p></SecurityGroup>)).not.toContain(' open');
  });
});
