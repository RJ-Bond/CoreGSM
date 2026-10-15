import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentPath, navigate, parseRoute, routeQuery } from '../src/ui/route';

// a minimal window: the address and the history API, enough for the router
function fakeWindow(url: string) {
  const loc = new URL(url);
  const location = {
    get pathname() { return loc.pathname; },
    get search() { return loc.search; },
    get hash() { return loc.hash; },
    get origin() { return loc.origin; },
    get href() { return loc.href; },
  };
  const history = {
    entries: [loc.href],
    pushState(_s: unknown, _t: string, to: string) { loc.href = new URL(to, loc.href).href; this.entries.push(loc.href); },
    replaceState(_s: unknown, _t: string, to: string) { loc.href = new URL(to, loc.href).href; this.entries[this.entries.length - 1] = loc.href; },
  };
  return { location, history, addEventListener() {} };
}

describe('router', () => {
  const g = globalThis as unknown as { window?: unknown };
  const saved = g.window;
  let w: ReturnType<typeof fakeWindow>;
  beforeEach(() => { w = fakeWindow('https://gsm.example.com/'); g.window = w; });
  afterEach(() => { g.window = saved; });

  it('reads the route from the path', () => {
    g.window = w = fakeWindow('https://gsm.example.com/servers/12/players?x=1');
    expect(parseRoute()).toEqual({ page: 'servers', sub: '12/players' });
    expect(currentPath()).toBe('/servers/12/players');
    expect(routeQuery().get('x')).toBe('1');
  });

  it('old #/ links and links with a token still work', () => {
    g.window = w = fakeWindow('https://gsm.example.com/#/servers/3?filter=online');
    expect(parseRoute()).toEqual({ page: 'servers', sub: '3' });
    expect(routeQuery().get('filter')).toBe('online');
    g.window = w = fakeWindow('https://gsm.example.com/#/reset/abc_DEF-1');
    expect(parseRoute()).toEqual({ page: 'reset', sub: 'abc_DEF-1' });
  });

  it('the root is the empty page', () => {
    expect(parseRoute()).toEqual({ page: '', sub: '' });
  });

  it('navigate pushes a clean path and drops an old fragment; replace adds no entry', () => {
    g.window = w = fakeWindow('https://gsm.example.com/#/auth/secret-token');
    navigate('/servers', { replace: true });
    expect(w.location.href).toBe('https://gsm.example.com/servers');
    expect(w.history.entries).toHaveLength(1);
    navigate('#/admin/news');
    expect(w.location.href).toBe('https://gsm.example.com/admin/news');
    expect(w.history.entries).toHaveLength(2);
    expect(parseRoute()).toEqual({ page: 'admin', sub: 'news' });
  });
});
