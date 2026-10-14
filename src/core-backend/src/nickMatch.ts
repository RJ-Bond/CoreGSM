/** Pure helpers for matching an in-game nick against names seen on the servers. */

/** Levenshtein distance; gives up early (returns max + 1) when it certainly exceeds `max`. */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** distinct (case-insensitive) non-empty names, order kept, first spelling wins */
export function distinctNames(names: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = String(raw ?? '').trim();
    const k = n.toLowerCase();
    if (!n || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/** Autocomplete: names that start with the typed text first, then names that contain it; source order kept inside each group. */
export function suggestNames(query: string, candidates: string[], limit = 25): string[] {
  const q = query.trim().toLowerCase();
  const names = distinctNames(candidates).filter((n) => n.length <= 100);
  if (!q) return names.slice(0, limit);
  const starts: string[] = [];
  const contains: string[] = [];
  for (const n of names) {
    const l = n.toLowerCase();
    if (l.startsWith(q)) starts.push(n);
    else if (l.includes(q)) contains.push(n);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** Names that look like a mistyped `nick`: one contains the other (3+ letters) or the edit distance is at most 2. Closest first; the nick itself is excluded. */
export function similarNames(nick: string, candidates: string[], limit = 5): string[] {
  const t = nick.trim().toLowerCase();
  if (!t) return [];
  const scored: { n: string; d: number }[] = [];
  for (const n of distinctNames(candidates)) {
    const l = n.toLowerCase();
    if (l === t) continue;
    const d = levenshtein(t, l, 2);
    const sub = Math.min(l.length, t.length) >= 3 && (l.includes(t) || t.includes(l));
    if (d <= 2 || sub) scored.push({ n, d: Math.min(d, 3) });
  }
  scored.sort((x, y) => x.d - y.d);
  return scored.slice(0, limit).map((s) => s.n);
}
