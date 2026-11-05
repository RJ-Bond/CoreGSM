/** The auto-answers of the bot (FAQ): keywords of an entry, which entry fits a question. Pure. */

export interface FaqEntry {
  id: number;
  title: string;
  keywords: string[];
  answer: string;
}

export const MAX_KEYWORDS = 20;
export const MAX_ANSWER = 1500;

/** lower case, «ё» as «е», punctuation as spaces, single spaces */
export const normalize = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** keywords from a comma or line separated text: 2..40 characters each, distinct, at most 20 */
export function parseKeywords(raw: string | string[]): string[] {
  const parts = Array.isArray(raw) ? raw : raw.split(/[,\n;]/);
  const out: string[] = [];
  for (const p of parts) {
    const k = normalize(String(p));
    if (k.length >= 2 && k.length <= 40 && !out.includes(k)) out.push(k);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

/**
 * The entry whose keywords appear in the text (as whole words or phrases): more matching keywords win, then the longer ones.
 * Nothing when nothing fits or the text is too short to mean anything.
 */
export function matchFaq(text: string, list: FaqEntry[]): FaqEntry | null {
  const t = ` ${normalize(text)} `;
  if (t.trim().length < 3) return null;
  let best: { e: FaqEntry; hits: number; len: number } | null = null;
  for (const e of list) {
    let hits = 0;
    let len = 0;
    for (const k of e.keywords) {
      if (t.includes(` ${k} `)) {
        hits++;
        len = Math.max(len, k.length);
      }
    }
    if (hits && (!best || hits > best.hits || (hits === best.hits && len > best.len))) best = { e, hits, len };
  }
  return best?.e ?? null;
}
