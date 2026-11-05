import { describe, expect, it } from 'vitest';
import { badgeSnippets, WIDGET_SIZES } from './integrationsLogic';

describe('badgeSnippets', () => {
  it('builds the links and escapes the name', () => {
    const s = badgeSnippets('https://e.x/', 7, 'A "b" [c] <d>');
    expect(s.badge).toBe('https://e.x/badge/servers/7.svg');
    expect(s.widget).toBe('https://e.x/widget/servers/7');
    expect(s.markdown).toBe('[![A "b" \\[c\\] <d>](https://e.x/badge/servers/7.svg)](https://e.x/servers/7)');
    expect(s.html).toContain('alt="A &quot;b&quot; [c] &lt;d&gt;"');
    expect(s.iframe).toContain('src="https://e.x/widget/servers/7"');
    expect(s.bbcode).toBe('[url=https://e.x/servers/7][img]https://e.x/badge/servers/7.svg[/img][/url]');
  });

  it('the widget takes the theme and the size of the builder', () => {
    const d = badgeSnippets('https://e.x', 7, 'S', { theme: 'dark', size: 'l' });
    expect(d.widget).toBe('https://e.x/widget/servers/7?theme=dark');
    expect(d.iframe).toContain(`width="${WIDGET_SIZES.l.w}" height="${WIDGET_SIZES.l.h}"`);
    expect(d.iframe).toContain('src="https://e.x/widget/servers/7?theme=dark"');
    const auto = badgeSnippets('https://e.x', 7, 'S', { theme: 'auto' });
    expect(auto.widget).toBe('https://e.x/widget/servers/7');
    expect(auto.iframe).toContain('width="320" height="140"');
  });

  it('the picture card carries its style and theme, and the default has no query', () => {
    expect(badgeSnippets('https://e.x', 7, 'S').card).toBe('https://e.x/api/card/7.png');
    expect(badgeSnippets('https://e.x', 7, 'S', { cardStyle: 'strip', cardTheme: 'light' }).card).toBe('https://e.x/api/card/7.png?style=strip&theme=light');
    const c = badgeSnippets('https://e.x', 7, 'A "b"', { cardTheme: 'light' });
    expect(c.cardHtml).toBe('<a href="https://e.x/servers/7"><img src="https://e.x/api/card/7.png?theme=light" alt="A &quot;b&quot;" style="max-width:100%"></a>');
    expect(c.cardMarkdown).toBe('[![A "b"](https://e.x/api/card/7.png?theme=light)](https://e.x/servers/7)');
  });

  it('the widget takes the corner radius and the font, and the default look has no query', () => {
    expect(badgeSnippets('https://e.x', 7, 'S').widget).toBe('https://e.x/widget/servers/7');
    expect(badgeSnippets('https://e.x', 7, 'S', { radius: 16, font: 'mono' }).widget).toBe('https://e.x/widget/servers/7?radius=16&font=mono');
    expect(badgeSnippets('https://e.x', 7, 'S', { theme: 'dark', radius: 99 }).widget).toBe('https://e.x/widget/servers/7?theme=dark&radius=24');
    expect(badgeSnippets('https://e.x', 7, 'S', { radius: 8, font: 'sans' }).widget).toBe('https://e.x/widget/servers/7');
  });
});
