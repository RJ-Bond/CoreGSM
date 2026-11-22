/** Buttons under a push notification («Открыть», «Играть»): the service worker opens the address of the pressed one. */

export interface PushAction { action: string; title: string; url: string }

/** at most two buttons (some systems show no more), an id of letters, a short title, an address on the panel itself */
export function cleanActions(raw: unknown): PushAction[] {
  if (!Array.isArray(raw)) return [];
  const out: PushAction[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    const action = typeof x.action === 'string' ? x.action : '';
    const title = typeof x.title === 'string' ? x.title.trim().slice(0, 24) : '';
    const url = typeof x.url === 'string' ? x.url : '';
    if (!/^[a-z]{1,12}$/.test(action) || !title) continue;
    // an address of the panel: «/servers/3», never «//host» or another scheme
    if (!url.startsWith('/') || url.startsWith('//') || url.includes('\\')) continue;
    if (out.some((a) => a.action === action)) continue;
    out.push({ action, title, url: url.slice(0, 300) });
    if (out.length === 2) break;
  }
  return out;
}

/** the two buttons of a notification about a server: its page, and the tab with the way to connect */
export const serverActions = (serverId: number): PushAction[] => [
  { action: 'open', title: 'Открыть', url: `/servers/${serverId}` },
  { action: 'play', title: 'Играть', url: `/servers/${serverId}/connect` },
];
