import { describe, expect, it } from 'vitest';
import { badgeSnippets } from './integrationsLogic';

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
});
