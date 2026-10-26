/** The 24-hour chart under a server's Discord message: the pure part. */

/** the colour of one square of the players bar: the game's colour, amber near the top, red at the very top */
export function barSquare(index: number, total: number, base: string): string {
  // the last square is red, the one before amber: a nearly full server reads as «hot» at a glance
  if (index === total - 1) return '🟥';
  if (index === total - 2) return '🟧';
  return base;
}

/** «🟩🟩🟩🟧⬛⬛»: filled squares coloured by position; a server with players always shows at least one square */
export function playersBar(players: number, max: number, base: string, total = 6): string {
  if (!max) return '';
  const ratio = Math.min(players, max) / max;
  let n = Math.round(ratio * total);
  if (players > 0 && n === 0) n = 1;
  return Array.from({ length: total }, (_, i) => (i < n ? barSquare(i, total, base) : '⬛')).join('');
}

/** chart points: empty buckets count as 0, the scale is at least 1 player */
export function chartScale(players: (number | null)[]): { values: number[]; max: number } {
  const values = players.map((v) => v ?? 0);
  return { values, max: Math.max(1, ...values) };
}
