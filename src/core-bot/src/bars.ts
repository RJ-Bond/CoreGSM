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

const SQUARES: [string, [number, number, number]][] = [
  ['🟥', [221, 46, 68]], ['🟧', [244, 144, 12]], ['🟨', [253, 203, 88]], ['🟩', [120, 177, 89]], ['🟦', [85, 172, 238]], ['🟪', [170, 142, 214]], ['🟫', [193, 105, 79]],
];

/** the coloured square closest to a «#rrggbb» colour (purple when it cannot be read) */
export function squareOfHex(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '🟪';
  const n = parseInt(m[1]!, 16);
  const c: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let best = SQUARES[0]!;
  let bd = Infinity;
  for (const q of SQUARES) {
    const d = (q[1][0] - c[0]) ** 2 + (q[1][1] - c[1]) ** 2 + (q[1][2] - c[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best[0];
}

/** progress to the next rank: ten squares in the colour of the rank */
export function rankBar(progress: number, hex: string, total = 10): string {
  const n = Math.max(0, Math.min(total, Math.round((Number.isFinite(progress) ? progress : 0) * total)));
  return squareOfHex(hex).repeat(n) + '⬛'.repeat(total - n);
}
