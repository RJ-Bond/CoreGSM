/** How the lines that a player reads are painted (the same for the registration, the moderation and the reminders). */
import { plainLine } from './gameNewsJoinLeave.js';
import { PALETTE } from './gameNewsPalette.js';

/** the nickname in a line: bold yellow, so that it stands out from the text */
export const C_NICK: string = PALETTE.info;
/** the quiet parts of a line: separators, «to the next rank» */
export const C_DIM = '#8A94A3';

/**
 * A word picked out in a line. A plain string is a nickname or a login (bold, the colour of the nickname).
 * A pair is [word, colour] (bold); a triple is [word, colour, bold]: «false» paints it without bold (for quiet parts).
 */
export type Accent = string | [string, string] | [string, string, boolean];

/** a piece of text in one colour; the dot between the parts of a line («·») is always quiet */
function paint(color: string, text: string, bold = false): string {
  if (!text) return '';
  const open = bold ? '<b>' : '';
  const close = bold ? '</b>' : '';
  const out: string[] = [];
  text.split(/(·)/u).forEach((p) => {
    if (!p) return;
    out.push(p === '·' ? `<color=${C_DIM}>·</color>` : `<color=${color}>${open}${p}${close}</color>`);
  });
  return out.join('');
}

/**
 * The commands of a line: «.register» in white bold and the arguments after it, «(пароль)», in lilac (like the usage line of
 * the commands of the game). The tags are flat, so no client has to nest them.
 */
function pieces(color: string, plain: string): string[] {
  const parts: string[] = [];
  let last = 0;
  for (const m of plain.matchAll(/(^|\s)(\.[a-zа-я]+)((?:\s*\([^()]{1,40}\))*)/giu)) {
    const start = (m.index ?? 0) + m[1].length;
    if (start > last) parts.push(paint(color, plain.slice(last, start)));
    parts.push(`<color=#FFFFFF><b>${m[2]}</b></color>`);
    if (m[3]) parts.push(`<color=#B9A7FF>${m[3]}</color>`);
    last = start + m[2].length + m[3].length;
  }
  if (last < plain.length) parts.push(paint(color, plain.slice(last)));
  return parts;
}

/** `names`: the words that are picked out wherever they stand in the line (a nickname, a login, a date, a rank) */
export function tag(color: string, text: string, names: Accent[] = []): string {
  const plain = plainLine(text);
  const style = new Map<string, { color: string; bold: boolean }>();
  for (const n of names) {
    const [w, c, b] = typeof n === 'string' ? [n, C_NICK, true] : [n[0], n[1], n.length === 3 ? n[2] : true];
    const word = plainLine(w);
    if (word.length > 0 && !style.has(word)) style.set(word, { color: c, bold: b });
  }
  const words = [...style.keys()].sort((x, y) => y.length - x.length);
  let parts: string[];
  if (words.length === 0) parts = pieces(color, plain);
  else {
    const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu');
    parts = [];
    let last = 0;
    for (const m of plain.matchAll(re)) {
      const i = m.index ?? 0;
      if (i > last) parts.push(...pieces(color, plain.slice(last, i)));
      const st = style.get(m[0]) ?? { color: C_NICK, bold: true };
      parts.push(paint(st.color, m[0], st.bold));
      last = i + m[0].length;
    }
    if (last < plain.length) parts.push(...pieces(color, plain.slice(last)));
  }
  return parts.length ? parts.join('') : `<color=${color}></color>`;
}

/** a colour lifted towards white: the dark colours of the ranks are hard to read in the game chat */
export function lift(hex: string, amount = 0.4): string {
  const n = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!n) return '#FFFFFF';
  const v = parseInt(n[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((v >> 16) & 255), g = mix((v >> 8) & 255), b = mix(v & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}
