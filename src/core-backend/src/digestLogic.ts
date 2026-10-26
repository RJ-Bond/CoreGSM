/** Pure helpers of the weekly digest picture (no database, so tests can import them). */

/** The highest online of every listed day: `days` are local day keys, `dayOf` maps a timestamp to its key. */
export function dailyPeaks(rows: { ts: number; players: number }[], days: string[], dayOf: (ts: number) => string): number[] {
  const peak = new Map(days.map((d) => [d, 0]));
  for (const r of rows) {
    const k = dayOf(r.ts);
    const cur = peak.get(k);
    if (cur !== undefined && r.players > cur) peak.set(k, r.players);
  }
  return days.map((d) => peak.get(d) ?? 0);
}

/** Change against the week before as a rounded percent; null when there was nothing to compare with. */
export function changePct(cur: number, prev: number): number | null {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
}

/** Points of a small line chart inside a box: x from 0 to w, y from h (zero) up to 0 (the highest value). */
export function sparkPoints(values: number[], w: number, h: number): [number, number][] {
  const max = Math.max(1, ...values);
  const n = values.length;
  return values.map((v, i) => [n <= 1 ? w / 2 : (i / (n - 1)) * w, h - (v / max) * h]);
}

/**
 * Names of servers of one project usually start the same («[RU] Just-Skill.Ru | Standard», «[RU] Just-Skill.Ru | Hardcore»):
 * on the picture the shared start is cut so the part that tells them apart is visible. The cut is made at a word boundary
 * and only when every name keeps at least 3 characters; a single name is left as it is.
 */
export function stripCommonPrefix(names: string[]): string[] {
  if (names.length < 2) return names;
  let n = 0;
  const first = names[0]!;
  while (n < first.length && names.every((x) => x[n]?.toLowerCase() === first[n]!.toLowerCase())) n++;
  // back to the end of the last whole word/separator inside the shared start
  const cut = first.slice(0, n).search(/[\s|\-–—:·/\]]\S*$/);
  if (cut < 0) return names;
  let end = cut;
  while (end < n && /[\s|\-–—:·/\]]/.test(first[end]!)) end++;
  const out = names.map((x) => x.slice(end).trim());
  return out.every((x) => x.length >= 3) ? out : names;
}

/** a name split over at most `lines` lines of `max` characters by words; the end is cut with «…» when it does not fit */
export function wrapName(name: string, max: number, lines = 2): string[] {
  const out: string[] = [];
  let rest = name.trim();
  while (rest && out.length < lines) {
    if (rest.length <= max) { out.push(rest); rest = ''; break; }
    let at = rest.lastIndexOf(' ', max);
    if (at < Math.floor(max / 2)) at = max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out[out.length - 1] = `${out[out.length - 1]!.slice(0, Math.max(1, max - 1))}…`;
  return out;
}

/** «▲ 18%», «▼ 5%», «= как раньше»; null when there is nothing to compare with */
export function trendText(pct: number | null): { text: string; kind: 'up' | 'down' | 'same' } | null {
  if (pct == null) return null;
  if (pct === 0) return { text: '=', kind: 'same' };
  return pct > 0 ? { text: `▲ ${pct}%`, kind: 'up' } : { text: `▼ ${Math.abs(pct)}%`, kind: 'down' };
}

/** index of the busiest day (the first one on a tie); -1 when nobody played */
export function busiestDay(values: number[]): number {
  let at = -1;
  let best = 0;
  values.forEach((v, i) => { if (v > best) { best = v; at = i; } });
  return at;
}

/** the rows of the picture: up to `max`; when there are more, the last row stands for «ещё N» */
export function splitServers<T>(list: T[], max = 5): { shown: T[]; hidden: T[] } {
  if (list.length <= max) return { shown: list, hidden: [] };
  return { shown: list.slice(0, max - 1), hidden: list.slice(max - 1) };
}

/** width of the uptime bar in px: 0..full, a visible sliver for anything above zero */
export function uptimeBar(uptime: number | null, full: number): number {
  if (uptime == null) return 0;
  const w = Math.round((Math.min(100, Math.max(0, uptime)) / 100) * full);
  return uptime > 0 ? Math.max(3, w) : 0;
}
