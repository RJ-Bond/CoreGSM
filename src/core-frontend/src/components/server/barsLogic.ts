/** The bars of the «Players» chart: the period cut into equal buckets, the peak of every bucket, the highest one marked. */
export interface BarPoint { ts: number; players: number | null; online?: boolean | number }
export interface Bar { from: number; to: number; peak: number | null }

/** 24 bars for a day (one an hour), 28 for a week, 30 for a month */
export const barCount = (hours: number): number => (hours <= 24 ? 24 : hours <= 168 ? 28 : 30);

export function bucketPeaks(points: BarPoint[], hours: number, now: number): Bar[] {
  const n = barCount(hours);
  const span = hours * 3_600_000;
  const start = now - span;
  const step = span / n;
  const bars: Bar[] = Array.from({ length: n }, (_, i) => ({ from: start + i * step, to: start + (i + 1) * step, peak: null }));
  for (const p of points) {
    if (p.players == null || p.online === false || p.online === 0 || p.ts < start || p.ts > now) continue;
    const i = Math.min(n - 1, Math.floor((p.ts - start) / step));
    const b = bars[i];
    if (b.peak == null || p.players > b.peak) b.peak = p.players;
  }
  return bars;
}

/** the index of the highest bar (the latest one when several are equal), -1 when there is no data */
export function highestBar(bars: Bar[]): number {
  let at = -1;
  bars.forEach((b, i) => { if (b.peak != null && (at < 0 || b.peak >= (bars[at].peak as number))) at = i; });
  return at;
}
