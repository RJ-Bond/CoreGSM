/** The journal of joins and departures: pairs «came → left» into one line, filters, day groups, players who keep reconnecting. */

export interface ConnectionItem { id: number; serverId?: number; serverName: string; ts: number; kind: 'join' | 'leave'; platformId: string; nick: string; reason: string; removedBy: string; minutes: number; /** plugin 0.18.10+: the ping before the departure */ ping?: string }

/** one line of the journal: a finished visit (join + leave), a visit that goes on (join only) or a departure whose arrival is not known */
export interface Row {
  key: string;
  /** the player: platform id, or the nickname when the game gave no id */
  who: string;
  nick: string;
  serverId?: number;
  serverName: string;
  join: ConnectionItem | null;
  leave: ConnectionItem | null;
  /** the moment the line is sorted and grouped by: the departure, else the arrival */
  at: number;
  /** the visit is going on: no departure after the arrival */
  inGame: boolean;
}

export type Status = 'all' | 'inGame' | 'self' | 'timeout' | 'kicked';
export const STATUSES: Status[] = ['all', 'inGame', 'self', 'timeout', 'kicked'];
export type Period = 'day' | 'week' | 'all';
export const PERIODS: Period[] = ['day', 'week', 'all'];
export const SHORT_VISIT_MIN = 3;
export const REPEAT_JOINS = 3;
export const REPEAT_WINDOW_MS = 60 * 60_000;

const whoOf = (c: ConnectionItem): string => (c.platformId || c.nick || '?').toLowerCase();
const MIN = 60_000;

/**
 * Items come newest first. A departure carries «minutes in the game», so its arrival is `ts − minutes` (a minute or two off):
 * the nearest earlier arrival of the same player on the same server that is not taken yet becomes its pair.
 */
export function buildRows(items: ConnectionItem[]): Row[] {
  const used = new Set<number>();
  const joinsOf = new Map<string, ConnectionItem[]>();
  for (const c of items) {
    if (c.kind !== 'join') continue;
    const k = `${c.serverId ?? c.serverName}|${whoOf(c)}`;
    const list = joinsOf.get(k) ?? [];
    list.push(c); // newest first
    joinsOf.set(k, list);
  }
  const rows: Row[] = [];
  for (const c of items) {
    if (c.kind !== 'leave') continue;
    const k = `${c.serverId ?? c.serverName}|${whoOf(c)}`;
    const list = joinsOf.get(k) ?? [];
    let pair: ConnectionItem | null = null;
    if (c.minutes >= 0) {
      const want = c.ts - c.minutes * MIN;
      let best = Infinity;
      for (const j of list) {
        if (used.has(j.id) || j.ts > c.ts) continue;
        const off = Math.abs(j.ts - want);
        if (off <= 2 * MIN + 30_000 && off < best) { pair = j; best = off; }
      }
    } else {
      // no length given: the latest arrival before the departure that nobody else took
      pair = list.find((j) => !used.has(j.id) && j.ts <= c.ts) ?? null;
    }
    if (pair) used.add(pair.id);
    rows.push({ key: `l${c.id}`, who: whoOf(c), nick: c.nick, serverId: c.serverId, serverName: c.serverName, join: pair, leave: c, at: c.ts, inGame: false });
  }
  const leaves = items.filter((c) => c.kind === 'leave');
  for (const c of items) {
    if (c.kind !== 'join' || used.has(c.id)) continue;
    const k = `${c.serverId ?? c.serverName}|${whoOf(c)}`;
    // still in the game: no departure of this player on this server after the arrival
    const gone = leaves.some((l) => `${l.serverId ?? l.serverName}|${whoOf(l)}` === k && l.ts >= c.ts);
    rows.push({ key: `j${c.id}`, who: whoOf(c), nick: c.nick, serverId: c.serverId, serverName: c.serverName, join: c, leave: null, at: c.ts, inGame: !gone });
  }
  return rows.sort((a, b) => b.at - a.at || b.key.localeCompare(a.key));
}

export const isTimeout = (r: Row): boolean => !!r.leave && /^Timeout/.test(r.leave.reason);
export const isKicked = (r: Row): boolean => !!r.leave && (/^(Kicked|Banned)/.test(r.leave.reason) || !!r.leave.removedBy);
export const isSelf = (r: Row): boolean => !!r.leave && /^LeftGame/.test(r.leave.reason) && !r.leave.removedBy;

export function matchesStatus(r: Row, s: Status): boolean {
  if (s === 'all') return true;
  if (s === 'inGame') return r.inGame;
  if (s === 'self') return isSelf(r);
  if (s === 'timeout') return isTimeout(r);
  return isKicked(r);
}

export const periodSince = (p: Period, now = Date.now()): number => (p === 'day' ? now - 24 * 60 * MIN : p === 'week' ? now - 7 * 24 * 60 * MIN : 0);

/** the length of the visit in minutes: from the departure, else (a visit that goes on) from the arrival */
export function visitMinutes(r: Row, now = Date.now()): number | null {
  if (r.leave && r.leave.minutes >= 0) return r.leave.minutes;
  if (r.join && r.leave) return Math.max(0, Math.round((r.leave.ts - r.join.ts) / MIN));
  if (r.join && r.inGame) return Math.max(0, Math.round((now - r.join.ts) / MIN));
  return null;
}

/** players who came REPEAT_JOINS times within an hour (a bad connection, a crash on entering): the keys */
export function repeaters(items: ConnectionItem[]): Set<string> {
  const byWho = new Map<string, number[]>();
  for (const c of items) {
    if (c.kind !== 'join') continue;
    const k = whoOf(c);
    byWho.set(k, [...(byWho.get(k) ?? []), c.ts]);
  }
  const out = new Set<string>();
  for (const [k, list] of byWho) {
    const ts = [...list].sort((a, b) => a - b);
    for (let i = 0; i + REPEAT_JOINS - 1 < ts.length; i++) {
      if (ts[i + REPEAT_JOINS - 1]! - ts[i]! <= REPEAT_WINDOW_MS) { out.add(k); break; }
    }
  }
  return out;
}

export interface DayGroup { day: string; rows: Row[] }
/** local calendar day of a moment: YYYY-MM-DD */
export const dayKey = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** rows already sorted newest first, cut into days */
export function groupByDay(rows: Row[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const r of rows) {
    const day = dayKey(r.at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else out.push({ day, rows: [r] });
  }
  return out;
}
/** 'today' / 'yesterday' / null (the caller prints the date itself) */
export function dayWord(day: string, now = Date.now()): 'today' | 'yesterday' | null {
  if (day === dayKey(now)) return 'today';
  if (day === dayKey(now - 24 * 60 * MIN)) return 'yesterday';
  return null;
}
