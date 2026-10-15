/**
 * The current route, shared by every component that needs it. Addresses are plain paths ("/servers/12/players");
 * the old "#/servers/12" form still works, and links that carry a secret (the Discord sign-in token, password reset
 * and e-mail confirmation) keep using it on purpose: a fragment never reaches the server, so the token stays out
 * of request lines and access logs.
 */
import { useEffect, useState } from 'react';

export type Route = { page: string; sub: string };

/** "#/a/b?x" when the address has a route in the fragment, else "/a/b" */
const raw = (): string => (window.location.hash.startsWith('#/') ? window.location.hash.slice(1) : window.location.pathname);

/** Current route: "/servers/12" (or "#/servers/12") -> { page: 'servers', sub: '12' }. */
export function parseRoute(): Route {
  const [page = '', ...rest] = raw().split('?')[0].replace(/^\/+/, '').split('/');
  return { page, sub: rest.join('/') };
}

/** the query of the route: "?filter=lag" of the path, or the one written inside an old "#/servers?filter=lag" */
export function routeQuery(): URLSearchParams {
  const inHash = window.location.hash.startsWith('#/') ? window.location.hash.split('?')[1] : undefined;
  return new URLSearchParams(inHash ?? window.location.search);
}

/** the route as a path ("/servers/12"), for comparisons */
export const currentPath = () => {
  const r = parseRoute();
  return `/${r.page}${r.sub ? `/${r.sub}` : ''}`;
};

/** "/x", "#/x" or "x" -> "/x" */
const toPath = (to: string) => `/${to.replace(/^#?\/*/, '')}`;

const listeners = new Set<(r: Route) => void>();
let now: Route | null = null;

function notify() {
  const next = parseRoute();
  if (now && now.page === next.page && now.sub === next.sub) return;
  // No View Transition here: the glass header and the bottom bar (backdrop-filter) were captured as separate
  // layers and flashed as a black rectangle while switching sections. The page itself fades in via .pop / .fade-in.
  now = next;
  listeners.forEach((l) => l(next));
}

/** opens a route of the panel without reloading; `replace` does not add a history entry */
export function navigate(to: string, { replace = false }: { replace?: boolean } = {}): void {
  const path = toPath(to);
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  notify();
}

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  now = parseRoute();
  window.addEventListener('popstate', notify);
  window.addEventListener('hashchange', notify);
  // links to the panel's own pages open without a reload; everything else (API, files, new tabs) is left alone.
  // The listener sits on React's root container, added after React's own: a row that stops the click from
  // bubbling further (so that a link inside it does not also trigger the row) does not hide the click from it,
  // and a component that called preventDefault() is respected. The document listener covers portals.
  const root = document.getElementById('root');
  root?.addEventListener('click', onLinkClick);
  document.addEventListener('click', onLinkClick);
}

const ROUTED = Symbol('routed');
function onLinkClick(e: MouseEvent) {
  const ev = e as MouseEvent & { [ROUTED]?: boolean };
  if (ev[ROUTED]) return;
  ev[ROUTED] = true;
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.('a');
  if (!a || !a.hasAttribute('href') || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
  const href = a.getAttribute('href') ?? '';
  if (href.startsWith('#') && !href.startsWith('#/')) return; // an anchor on the page
  const url = new URL(a.href, window.location.href);
  if (url.origin !== window.location.origin) return;
  if (/^\/(api|go|s|assets)(\/|$)/.test(url.pathname) || /\.[a-z0-9]+$/i.test(url.pathname)) return;
  e.preventDefault();
  const target = href.startsWith('#/') ? href.slice(1) : `${url.pathname}${url.search}`;
  if (target === `${window.location.pathname}${window.location.search}` && !window.location.hash) return;
  navigate(target);
}

export function useRoute(): Route {
  const [r, setR] = useState(parseRoute);
  useEffect(() => {
    install();
    listeners.add(setR);
    // the address may have changed between the first render and now
    const cur = parseRoute();
    setR((p) => (p.page === cur.page && p.sub === cur.sub ? p : cur));
    return () => { listeners.delete(setR); };
  }, []);
  return r;
}
