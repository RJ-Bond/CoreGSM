/** Geometry of the health charts: pure functions, no drawing code. */

export interface Chart {
  path: string;
  area: string;
  /** y of the threshold line (undefined when there is none or it is off the chart) */
  limitY?: number;
  min: number;
  max: number;
  last: number | null;
  empty: boolean;
}

/**
 * `values` oldest first (null = no sample; the line breaks there). The vertical range is 0..max of the data and the
 * threshold, so a threshold line is always inside the chart and «how close to the limit» can be read at a glance.
 * `floor` keeps the bottom at the data minimum instead of zero (for values that never get near zero, like a database size).
 */
export function buildChart(values: (number | null)[], w: number, h: number, o: { limit?: number; floor?: boolean; pad?: number } = {}): Chart {
  const pad = o.pad ?? 3;
  const real = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!real.length) return { path: '', area: '', min: 0, max: 0, last: null, empty: true };
  const min = Math.min(...real);
  const max = Math.max(...real);
  const hi = Math.max(max, o.limit ?? -Infinity);
  const lo = o.floor ? Math.min(min, o.limit ?? Infinity) : Math.min(0, min);
  const span = hi - lo || 1;
  const n = values.length;
  const x = (i: number) => (n <= 1 ? w / 2 : pad + (i / (n - 1)) * (w - pad * 2));
  const y = (v: number) => pad + (1 - (v - lo) / span) * (h - pad * 2);
  const f = (v: number) => Math.round(v * 10) / 10;
  let path = '';
  let area = '';
  let seg: [number, number][] = [];
  const flush = () => {
    if (seg.length === 1) path += `M${f(seg[0][0] - 1)},${f(seg[0][1])}L${f(seg[0][0] + 1)},${f(seg[0][1])}`;
    else if (seg.length > 1) {
      const line = seg.map(([px, py], i) => `${i ? 'L' : 'M'}${f(px)},${f(py)}`).join('');
      path += line;
      area += `${line}L${f(seg[seg.length - 1][0])},${h}L${f(seg[0][0])},${h}Z`;
    }
    seg = [];
  };
  values.forEach((v, i) => { if (v == null || !Number.isFinite(v)) flush(); else seg.push([x(i), y(v)]); });
  flush();
  const last = [...values].reverse().find((v) => v != null && Number.isFinite(v)) ?? null;
  return { path, area, limitY: o.limit != null && o.limit >= lo && o.limit <= hi ? f(y(o.limit)) : undefined, min, max, last, empty: false };
}

export interface Segment { from: number; to: number; state: string }

/** Runs of the same bot state over time: each segment lasts until the next sample (the last one until `end`). */
export function stateSegments(samples: { ts: number; botState: string | null }[], end: number): Segment[] {
  const out: Segment[] = [];
  samples.forEach((s, i) => {
    const state = s.botState ?? 'unknown';
    const to = i + 1 < samples.length ? samples[i + 1].ts : Math.max(end, s.ts);
    const prev = out[out.length - 1];
    if (prev && prev.state === state) prev.to = to;
    else out.push({ from: s.ts, to, state });
  });
  return out;
}

/** Share of the time (0..1) the samples spent in a state for which `good` holds. */
export function shareOf(segs: Segment[], good: (state: string) => boolean): number {
  const total = segs.reduce((n, s) => n + (s.to - s.from), 0);
  if (!total) return 1;
  return segs.filter((s) => good(s.state)).reduce((n, s) => n + (s.to - s.from), 0) / total;
}
