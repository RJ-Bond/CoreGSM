/** /link wizard: ids and the list of nicks for the menu. No discord.js import. */

export type LinkAction = { kind: 'pick' } | { kind: 'manual' } | { kind: 'modal' } | { kind: 'agree'; nick: string };

export function parseLink(id: string): LinkAction | null {
  if (id === 'lnk:pick') return { kind: 'pick' };
  if (id === 'lnk:manual') return { kind: 'manual' };
  if (id === 'lnk:modal') return { kind: 'modal' };
  const m = /^lnk:ok:(.{2,40})$/s.exec(id);
  return m ? { kind: 'agree', nick: (m[1] as string).trim() } : null;
}

export const agreeId = (nick: string): string => `lnk:ok:${nick.trim().slice(0, 40)}`;

/** the options of the menu: distinct names (case does not matter), at most 25, each up to 100 characters */
export function nickOptions(names: unknown): { label: string; value: string }[] {
  if (!Array.isArray(names)) return [];
  const seen = new Set<string>();
  const out: { label: string; value: string }[] = [];
  for (const n of names) {
    if (typeof n !== 'string') continue;
    const v = n.trim().slice(0, 40);
    const k = v.toLowerCase();
    if (v.length < 2 || seen.has(k)) continue;
    seen.add(k);
    out.push({ label: v, value: v });
    if (out.length >= 25) break;
  }
  return out;
}

/** a nick typed by hand: 2..40 characters without control characters */
export function cleanNick(v: string): string | null {
  const n = v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return n.length >= 2 && n.length <= 40 ? n : null;
}
