/**
 * The bottom bar of a phone remembers where you were in each section: tap «Серверы» from another section and you land on the
 * server you had open, not on the list. Tapping the section you are already in goes to its start. Kept for the tab only.
 */
const SECTIONS = ['servers', 'news', 'status', 'community', 'bans'] as const;
const key = (page: string) => `coregsm_last_${page}`;

/** the path is worth remembering when it is deeper than the start of its section and belongs to it */
export function isDeepPath(page: string, path: string): boolean {
  return (SECTIONS as readonly string[]).includes(page) && path.startsWith(`/${page}/`) && path.length > page.length + 2;
}

export function rememberPath(page: string, path: string): void {
  try {
    if (isDeepPath(page, path)) sessionStorage.setItem(key(page), path);
    else if ((SECTIONS as readonly string[]).includes(page)) sessionStorage.removeItem(key(page));
  } catch { /* not remembered */ }
}

/** where the bar sends to a section: the remembered place, else the start (and the start for the section that is open now) */
export function lastPathOf(page: string, active: boolean): string {
  if (active) return `/${page}`;
  try {
    const v = sessionStorage.getItem(key(page));
    return v && isDeepPath(page, v) ? v : `/${page}`;
  } catch {
    return `/${page}`;
  }
}
