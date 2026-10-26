/**
 * Push for favourite servers: which events a poll result brings and how often one player may be told about the same
 * server. Pure functions; favoritePush.ts does the sending.
 *
 *   online     the server was down and answers again
 *   free_slot  the server was full (players >= the threshold) and now has room; hysteresis: once full it stays
 *              "full" until the count has dropped by 1 + releaseGap below the threshold, and the per-pair gap
 *              (FAV_GAP_MS) keeps a server that flaps around the limit from spamming
 *   down       the server was up and is now down (the poller has already confirmed it with its N-of-M check)
 */

export type FavEvent = 'online' | 'free_slot' | 'down';
export const FAV_EVENTS: readonly FavEvent[] = ['online', 'free_slot', 'down'];

export interface FavTrack {
  online: boolean;
  full: boolean;
}
export interface FavObs {
  online: boolean;
  players: number;
  maxPlayers: number;
}
export interface FavOptions {
  /** share of maxPlayers from which the server counts as full (1 = exactly full) */
  fullRatio?: number;
  /** extra slots that must free up below the threshold before it counts as "free" again */
  releaseGap?: number;
}

/** players from which a server is full; 0 = no limit known (never full) */
export function fullAt(maxPlayers: number, fullRatio = 1): number {
  if (!(maxPlayers > 0)) return 0;
  const ratio = Math.min(1, Math.max(0.5, fullRatio));
  return Math.max(1, Math.ceil(maxPlayers * ratio));
}

/** the next state and the events of one poll result; the first observation of a server brings no event */
export function nextFavTrack(prev: FavTrack | null, obs: FavObs, opts: FavOptions = {}): { next: FavTrack; events: FavEvent[] } {
  if (!obs.online) {
    return { next: { online: false, full: false }, events: prev && prev.online ? ['down'] : [] };
  }
  const at = fullAt(obs.maxPlayers, opts.fullRatio);
  const gap = Math.max(0, opts.releaseGap ?? 0);
  const reachedFull = at > 0 && obs.players >= at;
  const released = at > 0 && obs.players <= at - 1 - gap;
  if (!prev) return { next: { online: true, full: reachedFull }, events: [] };
  if (!prev.online) return { next: { online: true, full: reachedFull }, events: ['online'] };
  if (prev.full) {
    // stays full until the count has really dropped (hysteresis)
    return released ? { next: { online: true, full: false }, events: ['free_slot'] } : { next: { online: true, full: true }, events: [] };
  }
  return { next: { online: true, full: reachedFull }, events: [] };
}

/** minimum gap between two pushes of the same kind for one (player, server) pair */
export const FAV_GAP_MS: Record<FavEvent, number> = {
  online: 10 * 60_000,
  free_slot: 15 * 60_000,
  down: 10 * 60_000,
};

export const mayPushFav = (kind: FavEvent, last: number | undefined, now: number): boolean => last === undefined || now - last >= FAV_GAP_MS[kind];

/** the kind of the explicit subscription (subscriptions.ts) that already covers the same event */
export const SUBSCRIPTION_KIND: Record<FavEvent, 'back_online' | 'free_slot' | 'went_down'> = {
  online: 'back_online',
  free_slot: 'free_slot',
  down: 'went_down',
};

export function favText(kind: FavEvent, name: string, players: number, maxPlayers: number): string {
  if (kind === 'online') return `✅ Избранный сервер «${name}» снова в сети.`;
  if (kind === 'free_slot') return `🟢 На избранном сервере «${name}» освободилось место (${players}/${maxPlayers}).`;
  return `🔴 Избранный сервер «${name}» недоступен.`;
}

export interface FavPrefs {
  online: boolean;
  freeSlot: boolean;
  down: boolean;
}
export const DEFAULT_FAV_PREFS: FavPrefs = { online: true, freeSlot: true, down: false };

export const wantsFav = (p: FavPrefs, kind: FavEvent): boolean => (kind === 'online' ? p.online : kind === 'free_slot' ? p.freeSlot : p.down);
