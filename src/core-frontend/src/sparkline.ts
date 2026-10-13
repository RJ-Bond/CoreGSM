/** A tiny static sparkline: pure geometry, no drawing code. */

export interface Spark { path: string; area: string; min: number; max: number; last: number | null; empty: boolean }

/**
 * `values` oldest first (null = no sample). The line is scaled to the min..max of the data, with a flat line in the middle
 * when every value is the same. Gaps (null) break the line into separate segments.
 */
export function buildSparkline(values: (number | null)[], width: number, height: number, pad = 2): Spark {
  const real = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (real.length === 0) return { path: '', area: '', min: 0, max: 0, last: null, empty: true };
  const min = Math.min(...real);
  const max = Math.max(...real);
  const n = values.length;
  const x = (i: number) => (n <= 1 ? width / 2 : pad + (i / (n - 1)) * (width - pad * 2));
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2));
  const f = (v: number) => Math.round(v * 10) / 10;
  let path = '';
  let area = '';
  let seg: [number, number][] = [];
  const flush = () => {
    if (seg.length === 0) return;
    if (seg.length === 1) {
      // a lone sample: a short dash, so that it stays visible
      const [px, py] = seg[0];
      path += `M${f(px - 1)},${f(py)}L${f(px + 1)},${f(py)}`;
    } else {
      path += seg.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${f(px)},${f(py)}`).join('');
      area += `${seg.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${f(px)},${f(py)}`).join('')}L${f(seg[seg.length - 1][0])},${height}L${f(seg[0][0])},${height}Z`;
    }
    seg = [];
  };
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) flush();
    else seg.push([x(i), y(v)]);
  });
  flush();
  const lastReal = [...values].reverse().find((v) => v != null && Number.isFinite(v)) ?? null;
  return { path, area, min, max, last: lastReal, empty: false };
}

/** keeps at most `max` points by averaging neighbours (the chart stays light for 14 days of samples) */
export function downsample(values: (number | null)[], max: number): (number | null)[] {
  if (values.length <= max || max < 2) return values;
  const step = values.length / max;
  const out: (number | null)[] = [];
  for (let i = 0; i < max; i++) {
    const a = Math.floor(i * step);
    const b = Math.max(a + 1, Math.floor((i + 1) * step));
    const part = values.slice(a, b).filter((v): v is number => v != null);
    out.push(part.length ? part.reduce((s, v) => s + v, 0) / part.length : null);
  }
  return out;
}
