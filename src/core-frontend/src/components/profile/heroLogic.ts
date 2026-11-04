/** Pure parts of the profile page: the level ring, «the main thing today» and the account protection score. */
import type { Achievement, MyRank, Server } from '../../api';
import { VR_RANKS } from '../../vrisingRanks';

/** the level of a rank: its place in the ladder (1 = the first rank) */
export function rankLevel(rankId: string | null | undefined): { level: number; total: number } {
  const i = VR_RANKS.findIndex((r) => r.id === rankId);
  return { level: i < 0 ? 1 : i + 1, total: VR_RANKS.length };
}

export type Focus =
  | { kind: 'playing'; name: string; serverId: number; since: number }
  | { kind: 'rank'; name: string; color: string; hoursLeft: number; progress: number }
  | { kind: 'ach'; id: string; icon: string; title: string; progress: number; target: number }
  | { kind: 'fav'; name: string; serverId: number; players: number };

const achShare = (a: Achievement) => (a.target > 0 ? Math.max(0, Math.min(1, a.progress / a.target)) : 0);

/**
 * The one thing worth a look right now, by priority: you are in the game; a rank is close; an achievement is almost
 * earned; a favourite server has people on it; otherwise the way to the next rank. null: nothing to say.
 */
export function pickFocus(i: {
  playing: { name: string; serverId: number; since: number } | null | undefined;
  rank: MyRank | null | undefined;
  achievements: Achievement[] | null | undefined;
  favs: Server[] | null | undefined;
}): Focus | null {
  if (i.playing) return { kind: 'playing', ...i.playing };
  const r = i.rank && i.rank.nick && i.rank.next ? i.rank : null;
  const left = r?.next ? Math.max(0, r.next.minHours - r.hours) : null;
  if (r?.next && left !== null && left <= 5) return { kind: 'rank', name: r.next.name, color: r.next.color, hoursLeft: left, progress: r.progress };
  const near = (i.achievements ?? []).filter((a) => !a.earned && achShare(a) >= 0.6).sort((a, b) => achShare(b) - achShare(a))[0];
  if (near) return { kind: 'ach', id: near.id, icon: near.icon, title: near.title, progress: near.progress, target: near.target };
  const busy = (i.favs ?? []).filter((s) => s.online && s.players > 0).sort((a, b) => b.players - a.players)[0];
  if (busy) return { kind: 'fav', name: busy.name, serverId: busy.id, players: busy.players };
  if (r?.next && left !== null) return { kind: 'rank', name: r.next.name, color: r.next.color, hoursLeft: left, progress: r.progress };
  return null;
}

export type SecurityCheck = { id: 'email' | 'password' | 'tfa' | 'discord'; ok: boolean };

/** what makes an account safer, each with a done/not done mark; the 2FA state is known only after it was asked */
export function securityChecks(me: { emailVerified?: boolean; hasPassword: boolean; discordName: string | null }, tfaOn: boolean): SecurityCheck[] {
  return [
    { id: 'email', ok: !!me.emailVerified },
    { id: 'password', ok: me.hasPassword },
    { id: 'tfa', ok: tfaOn },
    { id: 'discord', ok: !!me.discordName },
  ];
}

/** the first thing still to do, or null when everything is done */
export const nextSecurityStep = (checks: SecurityCheck[]): SecurityCheck['id'] | null => checks.find((c) => !c.ok)?.id ?? null;

/** last `days` of the per-day seconds as 0/1 marks (oldest first), for the streak strip */
export function lastDaysMarks(byDay: { seconds: number }[], days: number): boolean[] {
  return byDay.slice(-days).map((d) => d.seconds > 0);
}
