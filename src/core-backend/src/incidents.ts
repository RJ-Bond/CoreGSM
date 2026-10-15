/**
 * Incidents: the stretches of the poll history in which a server did not answer. A single failed poll that the
 * poller has not confirmed yet (history.unconfirmed) is not an outage; a stretch inside a maintenance window
 * (history.maint) is a planned one. Shared by the status page, the server page and the weekly digest.
 */
import { db } from './db.js';

export interface Incident {
  serverId: number;
  start: number;
  /** null while the server is still down */
  end: number | null;
  minutes: number;
  /** players on the server at the last poll before it went down */
  playersBefore: number;
  planned: boolean;
}

export const DAY = 86_400_000;

/** every incident that ended after `since` (or is still going on), oldest first */
export function incidentsSince(since: number, serverId?: number, now = Date.now()): Incident[] {
  const rows = db
    .prepare(
      `SELECT server_id AS s, ts, online, players, COALESCE(unconfirmed, 0) AS u, COALESCE(maint, 0) AS m
       FROM history WHERE ts > ? ${serverId != null ? 'AND server_id = ?' : ''} ORDER BY server_id, ts`,
    )
    .all(...(serverId != null ? [since - DAY, serverId] : [since - DAY])) as { s: number; ts: number; online: number; players: number; u: number; m: number }[];
  const out: Incident[] = [];
  let cur: { serverId: number; start: number; playersBefore: number; planned: boolean } | null = null;
  let lastServer = -1;
  let lastPlayers = 0;
  const close = (end: number | null) => {
    if (!cur) return;
    const stop = end ?? now;
    if (stop > since) out.push({ ...cur, end, minutes: Math.max(1, Math.round((stop - cur.start) / 60_000)) });
    cur = null;
  };
  for (const r of rows) {
    if (r.s !== lastServer) {
      // the previous server's history ended while it was down: still going on
      close(null);
      lastServer = r.s;
      lastPlayers = 0;
    }
    const down = !r.online && !r.u;
    if (down) {
      if (!cur) cur = { serverId: r.s, start: r.ts, playersBefore: lastPlayers, planned: !!r.m };
      else if (r.m) cur.planned = true;
    } else {
      if (cur) close(r.ts);
      if (r.online) lastPlayers = r.players;
    }
  }
  close(null);
  return out;
}

/** minutes of downtime per UTC day (the days of uptime_daily), unplanned and planned apart */
export function downtimeByDay(list: Incident[], now = Date.now()): Map<string, { down: number; planned: number; count: number }> {
  const out = new Map<string, { down: number; planned: number; count: number }>();
  for (const i of list) {
    const end = i.end ?? now;
    let t = i.start;
    let first = true;
    while (t < end) {
      const dayEnd = (Math.floor(t / DAY) + 1) * DAY;
      const stop = Math.min(end, dayEnd);
      const key = `${i.serverId}|${new Date(t).toISOString().slice(0, 10)}`;
      const v = out.get(key) ?? { down: 0, planned: 0, count: 0 };
      const min = (stop - t) / 60_000;
      if (i.planned) v.planned += min;
      else v.down += min;
      if (first) v.count++;
      first = false;
      out.set(key, v);
      t = stop;
    }
  }
  return out;
}
