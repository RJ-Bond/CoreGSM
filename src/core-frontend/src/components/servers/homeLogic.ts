/** The home page: which servers get a card, which are named in a strip because they do not answer, and which wait empty. */
import type { Server } from '../../api';

export interface HomeGroups {
  /** a card each */
  cards: Server[];
  /** do not answer (and are not in maintenance): one narrow red line each, above the cards */
  down: Server[];
  /** answer, but nobody is on: compact rows under the cards */
  quiet: Server[];
}

/**
 * `rest` is every server but the big card, in the order of the page. A favourite keeps its card even when empty.
 * With nobody online there is nothing to push aside, and with `split` off (a filter, the selection mode) everything is a card.
 */
export function groupHome(rest: Server[], favs: number[], split: boolean, anyOnline: boolean): HomeGroups {
  if (!split || !anyOnline) return { cards: rest, down: [], quiet: [] };
  const down = rest.filter((s) => s.hasStatus && !s.online && !s.maintenance);
  const quiet = rest.filter((s) => s.online && s.players === 0 && !s.maintenance && !favs.includes(s.id));
  const aside = new Set([...down, ...quiet].map((s) => s.id));
  return { cards: rest.filter((s) => !aside.has(s.id)), down, quiet };
}
