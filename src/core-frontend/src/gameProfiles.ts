import { useEffect, useState } from 'react';
import { api } from './api';
import type { ConnectTemplates } from './connectGuides';

/** GET /games (public): what the panel knows about a game besides its name */
export interface GameProfile {
  id: string;
  label: string;
  defaultPort?: number;
  queryPortHint?: string;
  /** which details of the game the panel shows */
  fields?: { map?: unknown; mode?: unknown; version?: unknown; players?: unknown };
  connect?: ConnectTemplates;
  accent?: string;
}

export type GameProfiles = Record<string, GameProfile>;

let cache: GameProfiles | null = null;
let inflight: Promise<GameProfiles> | null = null;

/** one request per page load; a failure is not remembered (the next caller tries again) and gives an empty set */
export function loadGameProfiles(): Promise<GameProfiles> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api<GameProfile[]>('/games')
      .then((list) => {
        const out: GameProfiles = {};
        for (const g of Array.isArray(list) ? list : []) if (g && typeof g.id === 'string') out[g.id] = g;
        cache = out;
        return out;
      })
      .catch(() => ({}) as GameProfiles)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** null until the list is known; {} when the backend has no /games */
export function useGameProfiles(): GameProfiles | null {
  const [v, setV] = useState<GameProfiles | null>(cache);
  useEffect(() => {
    if (cache) { setV(cache); return; }
    let dead = false;
    void loadGameProfiles().then((g) => { if (!dead) setV(g); });
    return () => { dead = true; };
  }, []);
  return v;
}

/**
 * The port after another game was picked. A port the user typed is never replaced; an empty port always gets the
 * default; otherwise the default follows the game as long as the field still holds the previous game's default
 * (or there is no address yet, i.e. nothing worth keeping).
 */
export function nextPort(o: { current: number; touched: boolean; hasHost: boolean; prevDefault?: number; nextDefault?: number }): number {
  const empty = !Number.isFinite(o.current) || o.current <= 0;
  if (!o.nextDefault) return o.current;
  if (empty) return o.nextDefault;
  if (o.touched) return o.current;
  return !o.hasHost || o.current === o.prevDefault ? o.nextDefault : o.current;
}

/** names of the details the panel shows for the game: «карта / режим / версия» */
export function shownFields(fields: GameProfile['fields']): ('map' | 'mode' | 'version' | 'players')[] {
  if (!fields) return [];
  return (['map', 'mode', 'version', 'players'] as const).filter((k) => !!fields[k]);
}
