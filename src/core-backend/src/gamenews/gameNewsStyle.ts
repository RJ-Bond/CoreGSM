/** How the lines that a player reads are painted (the same for the registration, the moderation and the reminders). */
import { plainLine } from './gameNewsJoinLeave.js';

/**
 * A line the player reads: in one colour, with the commands picked out: «.register» in white bold and the arguments after it,
 * «(пароль)», in lilac (like the usage line of the commands of the game). The tags are flat, so no client has to nest them.
 */
/** the nickname in a line: bold yellow, so that it stands out from the text */
const C_NICK = '#FFCC33';

function pieces(color: string, plain: string): string[] {
  const parts: string[] = [];
  let last = 0;
  for (const m of plain.matchAll(/(^|\s)(\.[a-zа-я]+)((?:\s*\([^()]{1,40}\))*)/giu)) {
    const start = (m.index ?? 0) + m[1].length;
    if (start > last) parts.push(`<color=${color}>${plain.slice(last, start)}</color>`);
    parts.push(`<color=#FFFFFF><b>${m[2]}</b></color>`);
    if (m[3]) parts.push(`<color=#B9A7FF>${m[3]}</color>`);
    last = start + m[2].length + m[3].length;
  }
  if (last < plain.length) parts.push(`<color=${color}>${plain.slice(last)}</color>`);
  return parts;
}

/** a word picked out in a line: a plain string is a nickname or a login (bold yellow), a pair is [word, colour] */
export type Accent = string | [string, string];

/** `names`: the words that are picked out in bold wherever they stand in the line (a nickname, a login, a date, a rank) */
export function tag(color: string, text: string, names: Accent[] = []): string {
  const plain = plainLine(text);
  const colours = new Map<string, string>();
  for (const n of names) {
    const [w, c] = typeof n === 'string' ? [n, C_NICK] : n;
    const word = plainLine(w);
    if (word.length > 0 && !colours.has(word)) colours.set(word, c);
  }
  const words = [...colours.keys()].sort((x, y) => y.length - x.length);
  let parts: string[];
  if (words.length === 0) parts = pieces(color, plain);
  else {
    const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu');
    parts = [];
    let last = 0;
    for (const m of plain.matchAll(re)) {
      const i = m.index ?? 0;
      if (i > last) parts.push(...pieces(color, plain.slice(last, i)));
      parts.push(`<color=${colours.get(m[0]) ?? C_NICK}><b>${m[0]}</b></color>`);
      last = i + m[0].length;
    }
    if (last < plain.length) parts.push(...pieces(color, plain.slice(last)));
  }
  return parts.length ? parts.join('') : `<color=${color}></color>`;
}

