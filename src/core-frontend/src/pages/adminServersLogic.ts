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
