// Capacity helpers: how full a server is and how many free slots it has (pure, covered by tests).
export type CapLevel = 'ok' | 'warm' | 'hot';
export type SlotsKind = 'free' | 'almost' | 'full';

export const capacityPct = (players: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, Math.round((players / max) * 100))) : 0);

/** the bar colour: the game accent, amber from 75 %, red from 90 % */
export const capLevel = (pct: number): CapLevel => (pct >= 90 ? 'hot' : pct >= 75 ? 'warm' : 'ok');

/**
 * Free places: «Свободно 12 мест» (kind 'free'), «Почти полон» (90 % and more, kind 'almost'), «Мест нет» (kind 'full').
 * null when the server did not report a limit.
 */
export function slotsInfo(players: number, max: number): { kind: SlotsKind; free: number } | null {
  if (!(max > 0)) return null;
  const free = Math.max(0, max - Math.max(0, players));
  if (free === 0) return { kind: 'full', free };
  return { kind: capacityPct(players, max) >= 90 ? 'almost' : 'free', free };
}
