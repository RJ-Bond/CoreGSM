/** The fill bar of a server like in the monitoring card: squares in the colour of the game, the last two amber and red. Pure. */

/** the colour of the game: purple for V Rising, yellow for Icarus, green for the rest */
export const gameSquare = (game?: string | null): string => (game === 'vrising' ? '🟪' : game === 'icarus' ? '🟨' : '🟩');

/** «🟪🟪🟧⬛⬛⬛»: filled squares by the share of players; a server with players always shows at least one */
export function playersBar(players: number, max: number, game?: string | null, total = 6): string {
  if (!(max > 0)) return '';
  let n = Math.round((Math.min(Math.max(players, 0), max) / max) * total);
  if (players > 0 && n === 0) n = 1;
  const base = gameSquare(game);
  return Array.from({ length: total }, (_, i) => (i >= n ? '⬛' : i === total - 1 ? '🟥' : i === total - 2 ? '🟧' : base)).join('');
}
