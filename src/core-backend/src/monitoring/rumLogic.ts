/** The arithmetic of the speed of the pages (no imports: tested alone). */
export const RUM_METRICS = ['LCP', 'INP', 'CLS', 'TTFB', 'FCP'] as const;
export type RumMetric = (typeof RUM_METRICS)[number];

/** the thresholds of web.dev: good up to the first number, poor above the second */
export const RUM_LIMITS: Record<RumMetric, [number, number]> = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], TTFB: [800, 1800], FCP: [1800, 3000] };

/** nearest-rank percentile of a sorted list */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export function rating(metric: RumMetric, v: number): 'good' | 'needs' | 'poor' {
  const [good, poor] = RUM_LIMITS[metric];
  return v <= good ? 'good' : v <= poor ? 'needs' : 'poor';
}
