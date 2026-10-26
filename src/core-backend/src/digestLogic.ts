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
