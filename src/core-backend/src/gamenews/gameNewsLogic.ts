/**
 * Game news: the text that the CoreGSM game plugin shows in the in-game chat of a server.
 * Only a few rich-text tags survive: <color=#RRGGBB>…</color>, <b>, <i>. Everything else is cut out, so nobody can
 * break the chat with odd tags. The same rules are used by the editor preview in the panel (core-frontend/src/gameNews.ts).
 */

export const MAX_VISIBLE = 400;
export const MAX_RAW = 700;

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
  return { ok: true, text };
}

export const VARIABLES = ['server', 'online', 'max', 'time'] as const;
export type Vars = Record<(typeof VARIABLES)[number], string>;

/** {server} {online} {max} {time} become their values; unknown {words} stay as they are. The values never hold tags. */
export function applyVars(text: string, vars: Vars): string {
  return text.replace(/\{(server|online|max|time)\}/g, (_m, k: keyof Vars) => vars[k].replace(/[<>]/g, '').slice(0, 60));
}
