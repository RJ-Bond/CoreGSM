/** The default link-preview picture and monogram icons: the pure part. */

/** «12 игроков онлайн · 3 сервера из 4» for the preview; an empty panel says only what it is */
export function ogLine(i: { online: number; servers: number; players: number }): string {
  if (i.servers === 0) return 'Мониторинг игровых серверов';
  const word = (n: number, f: [string, string, string]) => (n % 10 === 1 && n % 100 !== 11 ? f[0] : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? f[1] : f[2]);
  return `${i.players} ${word(i.players, ['игрок', 'игрока', 'игроков'])} онлайн · ${i.online} из ${i.servers} ${word(i.servers, ['сервера', 'серверов', 'серверов'])} в сети`;
}

/** hue 0..359 from a name: the same game always gets the same colour */
export function hueOf(name: string): number {
  let h = 7;
  for (const c of name.toLowerCase()) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** "#rrggbb" from hue (0..359), saturation and lightness (0..1) */
export function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** the colour of the monogram of a game that has no colour of its own */
export const monogramColor = (name: string): string => hslHex(hueOf(name), 0.55, 0.5);

/** one or two letters for a game name: the capitals of its words («Space Engineers» → «SE»), else its first two letters */
export function monogramOf(label: string): string {
  const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}
