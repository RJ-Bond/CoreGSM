/** The card of a player in the journal of the plugin: what the visits, the moderation and the linked account say about him. */
import type { ModBan, ModEntry } from '../gameNews';
import type { ConnectionItem } from './connectionsLogic';

export interface PlayerFacts {
  /** how many times he came (the arrivals the journal has) */
  visits: number;
  /** the minutes of the visits that ended with a known length */
  minutes: number;
  /** when he was seen last: the latest arrival or departure */
  lastSeen: number | null;
  /** what the game said at his last departure (LeftGame, Timeout…) */
  lastReason: string;
  kicks: number;
  warns: number;
  bans: number;
  /** bans in force now */
  active: ModBan[];
  /** his own journal: newest first, at most `limit` */
  recent: ConnectionItem[];
}

export function playerFacts(nick: string, connections: ConnectionItem[], log: ModEntry[], bans: ModBan[], recentLimit = 6): PlayerFacts {
  const same = (a: string) => a.toLowerCase() === nick.toLowerCase();
  const own = connections.filter((c) => same(c.nick));
  const leaves = own.filter((c) => c.kind === 'leave');
  const joins = own.filter((c) => c.kind === 'join');
  const sorted = [...own].sort((a, b) => b.ts - a.ts);
  const mine = log.filter((l) => same(l.nick));
  return {
    visits: Math.max(joins.length, leaves.length),
    minutes: leaves.reduce((n, l) => n + (l.minutes >= 0 ? l.minutes : 0), 0),
    lastSeen: sorted[0]?.ts ?? null,
    lastReason: sorted.find((c) => c.kind === 'leave')?.reason ?? '',
    kicks: mine.filter((l) => l.kind === 'kick').length,
    warns: mine.filter((l) => l.kind === 'warn').length,
    bans: mine.filter((l) => l.kind === 'ban').length,
    active: bans.filter((b) => same(b.nick)),
    recent: sorted.slice(0, recentLimit),
  };
}

/** a length of play in hours and minutes */
export function playTime(minutes: number): { h: number; m: number } {
  return { h: Math.floor(minutes / 60), m: Math.round(minutes % 60) };
}
