// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { isDeepPath, lastPathOf, rememberPath } from './lastPath';

describe('where the bottom bar sends to a section', () => {
  beforeEach(() => sessionStorage.clear());
  it('remembers a deep place of a section and sends there, but the open section goes to its start', () => {
    rememberPath('servers', '/servers/5/players');
    expect(lastPathOf('servers', false)).toBe('/servers/5/players');
    expect(lastPathOf('servers', true)).toBe('/servers');
    expect(lastPathOf('news', false)).toBe('/news');
  });
  it('forgets it when the section is back at its start, and ignores other sections and other paths', () => {
    rememberPath('news', '/news/3');
    rememberPath('news', '/news');
    expect(lastPathOf('news', false)).toBe('/news');
    rememberPath('admin', '/admin/servers');
    expect(lastPathOf('admin', false)).toBe('/admin');
    expect(isDeepPath('servers', '/news/3')).toBe(false);
    expect(isDeepPath('servers', '/servers/')).toBe(false);
  });
});
