import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppFooter, footVersionText } from './ShellExtras';

describe('footVersionText', () => {
  it('writes a readable version as «v1.0.0.50»', () => expect(footVersionText('1.0.0.50')).toBe('v1.0.0.50'));
  it('leaves a short build id of an older install as it is', () => expect(footVersionText('0123456')).toBe('0123456'));
});

describe('AppFooter', () => {
  it('shows the version of the panel with a tooltip', () => {
    const html = renderToStaticMarkup(<AppFooter brand="CoreGSM" version="1.0.0.50" />);
    expect(html).toContain('v1.0.0.50');
    expect(html).toContain('app-foot-ver');
    expect(html).toMatch(/title="[^"]*1\.0\.0\.50[^"]*"/);
  });

  it('shows no version mark when the build has no name', () => {
    expect(renderToStaticMarkup(<AppFooter brand="CoreGSM" version={null} />)).not.toContain('app-foot-ver');
    expect(renderToStaticMarkup(<AppFooter brand="CoreGSM" />)).not.toContain('app-foot-ver');
  });

  it('has an svg icon for every link and for the version, all hidden from screen readers', () => {
    const html = renderToStaticMarkup(<AppFooter brand="CoreGSM" version="1.0.0.50" />);
    expect((html.match(/<svg/g) ?? []).length).toBe(6);
    expect((html.match(/aria-hidden="true"/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('keeps the brand and the section links', () => {
    const html = renderToStaticMarkup(<AppFooter brand="Моя панель" version="1.0.0.50" />);
    expect(html).toContain('Моя панель');
    expect(html).toContain('href="/servers"');
  });
});
