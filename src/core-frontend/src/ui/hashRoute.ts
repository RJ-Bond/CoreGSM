/** The current route, shared by every component that needs it. */
import { useEffect, useState } from 'react';
import { withViewTransition } from '../useMotion';

/** Current route from the URL hash: "#/servers/12" -> { page: 'servers', sub: '12' }. */
export function parseHash(): { page: string; sub: string } {
  const [page = '', ...rest] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { page, sub: rest.join('/') };
}

// One hashchange listener for the whole app: every subscriber is updated together, inside one view transition
// (cross-fade with a slight slide, and the server avatar morphing from its tile to the page banner).
type HashState = { page: string; sub: string };
let hashNow: HashState | null = null;
const hashListeners = new Set<(h: HashState) => void>();

const serverIdOf = (h: HashState) => (h.page === 'servers' && /^\d+$/.test(h.sub.split('/')[0]) ? h.sub.split('/')[0] : '');

/** gives the avatar of a server (tagged data-vt-avatar) the view-transition-name that pairs the old and the new page */
const nameAvatars = (ids: string[]) => {
  for (const id of new Set(ids.filter(Boolean))) {
    document.querySelector<HTMLElement>(`[data-vt-avatar="${id}"]`)?.style.setProperty('view-transition-name', `server-${id}`);
  }
};
const clearAvatarNames = () => {
  document.querySelectorAll<HTMLElement>('[data-vt-avatar]').forEach((el) => el.style.removeProperty('view-transition-name'));
};

function onHashChange() {
  const prev = hashNow ?? parseHash();
  const next = parseHash();
  if (prev.page === next.page && prev.sub === next.sub) return;
  // switching tabs inside one server page ("12" -> "12/players") is not a page change: no cross-fade
  if (prev.page === 'servers' && next.page === 'servers' && /^\d+(\/|$)/.test(next.sub) && prev.sub.split('/')[0] === next.sub.split('/')[0]) {
    hashNow = next;
    hashListeners.forEach((l) => l(next));
    return;
  }
  // No View Transition here: the glass header and the bottom bar (backdrop-filter) were captured as separate
  // layers and flashed as a black rectangle while switching sections. The page itself fades in via .pop / .fade-in.
  hashNow = next;
  hashListeners.forEach((l) => l(next));
}
void withViewTransition;
void nameAvatars;
void clearAvatarNames;
void serverIdOf;

export function useHash() {
  const [h, setH] = useState(parseHash);
  useEffect(() => {
    if (hashNow === null) {
      hashNow = parseHash();
      window.addEventListener('hashchange', onHashChange);
    }
    hashListeners.add(setH);
    // the address may have changed between the first render and now
    const cur = parseHash();
    setH((p) => (p.page === cur.page && p.sub === cur.sub ? p : cur));
    return () => { hashListeners.delete(setH); };
  }, []);
  return h;
}
