// Pure logic of the «Серверы» table in the admin area: filters, search and counts. Covered by tests.
import type { Server } from '../api';
import { LAG_PING } from '../ui/poll';

export type ServerFilter = 'all' | 'online' | 'problems';

/** not answering after a first answer, or slow; a server in a maintenance window is not a problem */
export const isProblem = (s: Server): boolean => !s.maintenance && s.hasStatus && (!s.online || (s.ping != null && s.ping > LAG_PING));

export function filterServers(list: Server[], filter: ServerFilter, query: string): Server[] {
  const q = query.trim().toLowerCase();
  return list.filter((s) => {
    if (filter === 'online' && !s.online) return false;
    if (filter === 'problems' && !isProblem(s)) return false;
    if (!q) return true;
    return [s.name, s.customName, s.game, s.host, String(s.port), s.displayAddress, s.map ?? ''].some((v) => (v ?? '').toLowerCase().includes(q));
  });
}

export function countServers(list: Server[]): Record<ServerFilter, number> {
  return { all: list.length, online: list.filter((s) => s.online).length, problems: list.filter(isProblem).length };
}

/** the order of ids after moving `id` one step up/down among `shown` (the servers on screen); null when it cannot move */
export function moveId(all: number[], shown: number[], id: number, dir: -1 | 1): number[] | null {
  const i = shown.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= shown.length) return null;
  const a = all.indexOf(id);
  const b = all.indexOf(shown[j]!);
  if (a < 0 || b < 0) return null;
  const out = [...all];
  [out[a], out[b]] = [out[b]!, out[a]!];
  return out;
}

const FILTER_KEY = 'coregsm_admin_srv_filter';
/** filter and search of the table survive leaving the page and coming back (per tab) */
export function loadTableState(): { filter: ServerFilter; query: string } {
  try {
    const v = JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? '{}') as { filter?: string; query?: string };
    const filter: ServerFilter = v.filter === 'online' || v.filter === 'problems' ? v.filter : 'all';
    return { filter, query: typeof v.query === 'string' ? v.query.slice(0, 100) : '' };
  } catch { return { filter: 'all', query: '' }; }
}
export function saveTableState(filter: ServerFilter, query: string): void {
  try {
    if (filter === 'all' && !query) sessionStorage.removeItem(FILTER_KEY);
    else sessionStorage.setItem(FILTER_KEY, JSON.stringify({ filter, query }));
  } catch { /* not remembered */ }
}

/** the columns of the wide table that can be switched on and off (the server, status, players, ping and actions are always there) */
export const TABLE_COLUMNS = ['uptime', 'h24', 'map', 'version', 'channels', 'updated'] as const;
export type TableColumn = (typeof TABLE_COLUMNS)[number];
export const DEFAULT_COLUMNS: TableColumn[] = ['uptime', 'h24'];
const COLUMNS_KEY = 'coregsm_admin_srv_cols';

/** a saved list of columns (anything unknown is dropped, the order is always the table's own) */
export function parseColumns(raw: string | null): TableColumn[] {
  if (raw == null) return [...DEFAULT_COLUMNS];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [...DEFAULT_COLUMNS];
    return TABLE_COLUMNS.filter((c) => v.includes(c));
  } catch { return [...DEFAULT_COLUMNS]; }
}
export function loadColumns(): TableColumn[] {
  try { return parseColumns(localStorage.getItem(COLUMNS_KEY)); } catch { return [...DEFAULT_COLUMNS]; }
}
export function saveColumns(cols: TableColumn[]): void {
  try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(cols)); } catch { /* not remembered */ }
}
