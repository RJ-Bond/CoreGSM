/**
 * Game news: the text that the CoreGSM game plugin shows in the in-game chat of a server.
 * Only a few rich-text tags survive: <color=#RRGGBB>…</color>, <b>, <i>. Everything else is cut out, so nobody can
 * break the chat with odd tags. The same rules are used by the editor preview in the panel (core-frontend/src/gameNews.ts).
 */

export const MAX_VISIBLE = 400;
export const MAX_RAW = 700;
/** the game chat takes 512 bytes; Cyrillic letters are 2 bytes each, tags count too */
export const MAX_BYTES = 500;

const TAG = /<\/?(?:color(?:=#[0-9a-fA-F]{6})?|b|i)>/g;

/** the text without any tags (what players read): used for the length check */
export function visibleText(raw: string): string {
  return raw.replace(/<[^>]*>/g, '');
}

/** removes control characters and not allowed tags, closes tags left open; returns '' for an empty result */
export function cleanNews(input: string): string {
  // control characters out, line breaks become spaces (the chat is one line)
  const s = input.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '');
  let out = '';
  let last = 0;
  const open: string[] = [];
  for (const m of s.matchAll(TAG)) {
    out += stripAngles(s.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[0].toLowerCase();
    const name = /^<\/?(color|b|i)/.exec(tag)![1];
    if (tag.startsWith('</')) {
      const i = open.lastIndexOf(name);
      if (i === -1) continue; // a closing tag without an opening one
      // close everything opened after it, then it
      for (let k = open.length - 1; k > i; k--) out += `</${open[k]}>`;
      out += `</${name}>`;
      open.length = i;
    } else {
      open.push(name);
      out += tag.startsWith('<color') ? `<color=${tag.slice(7, 14)}>` : tag;
    }
  }
  out += stripAngles(s.slice(last));
  for (let k = open.length - 1; k >= 0; k--) out += `</${open[k]}>`;
  return out.replace(/ {2,}/g, ' ').trim();
}

/** a whole tag that is not allowed (<size=500>, </x>) is cut out with its content kept; a stray < or > is dropped */
function stripAngles(t: string): string {
  return t.replace(/<[^<>]*>/g, '').replace(/[<>]/g, '');
}

export interface NewsCheck { ok: boolean; text: string; error?: string }

export function checkNews(input: unknown): NewsCheck {
  if (typeof input !== 'string') return { ok: false, text: '', error: 'Введите текст' };
  if (input.length > MAX_RAW) return { ok: false, text: '', error: `Слишком длинный текст (больше ${MAX_RAW} знаков с тегами)` };
  const text = cleanNews(input);
  const vis = visibleText(text).trim();
  if (!vis) return { ok: false, text: '', error: 'Введите текст' };
  if (vis.length > MAX_VISIBLE) return { ok: false, text: '', error: `Слишком длинное сообщение: ${vis.length} из ${MAX_VISIBLE} знаков` };
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_BYTES) return { ok: false, text: '', error: `Слишком длинное сообщение для игры: ${bytes} из ${MAX_BYTES} байт (русские буквы занимают по 2 байта)` };
  return { ok: true, text };
}

export const VARIABLES = ['server', 'online', 'max', 'time', 'greeting', 'restart', 'wipe', 'discord', 'tip'] as const;
export type Vars = Record<(typeof VARIABLES)[number], string>;

/** the variables become their values; unknown {words} stay as they are. The values never hold tags. */
export function applyVars(text: string, vars: Vars): string {
  return text.replace(/\{(server|online|max|time|greeting|restart|wipe|discord|tip)\}/g, (_m, k: keyof Vars) => vars[k].replace(/[<>]/g, '').slice(0, 200));
}

/** the colour of a player's name in the greeting */
export const NAME_COLOR = '#5FD068';

/** {name} outside any colour tag becomes green (a name the administrator coloured by hand is left alone) */
export function greenName(text: string): string {
  let depth = 0;
  return text
    .split(/(<\/?color(?:=#[0-9a-fA-F]{6})?>)/i)
    .map((part) => {
      if (/^<color=/i.test(part)) { depth++; return part; }
      if (/^<\/color>/i.test(part)) { depth = Math.max(0, depth - 1); return part; }
      return depth === 0 ? part.replace(/\{name\}/g, `<color=${NAME_COLOR}>{name}</color>`) : part;
    })
    .join('');
}

/**
 * The login for an account made from a game nickname: letters, digits, `_ . -` and single spaces, 3-32 characters
 * (the rule of the site). `taken` tells whether a login is used; a number is added until it is free.
 */
export function loginFromNick(nick: string, platformId: string, taken: (login: string) => boolean): string {
  let base = plainText(nick)
    .replace(/[^\p{L}\p{N}_. -]/gu, '_')
    .replace(/ {2,}/g, ' ')
    .replace(/^[ ]+|[ ]+$/g, '');
  if (base.length < 3) base = `Player_${platformId.slice(-4)}`;
  base = base.slice(0, 32).trim();
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = String(n);
    const cand = `${base.slice(0, 32 - suffix.length).trim()}${suffix}`;
    if (!taken(cand)) return cand;
  }
  return `${base.slice(0, 24)}_${Date.now() % 100000}`;
}


/** one line of plain text: no tags, no control characters */
function plainText(s: string): string {
  return Array.from(s, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('').replace(/[<>]/g, '').replace(/ {2,}/g, ' ').trim();
}
