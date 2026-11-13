import { t, useI18n } from '../i18n';

/** one row of the table under a chart: when, and the number */
export interface ChartRow { from: number; value: number }

/** the points of a chart reduced to a row per bucket: the highest value in it (players) or the mean (ping); buckets without data are left out */
export function bucketRows(points: { ts: number; value: number | null }[], bucketMs: number, how: 'max' | 'mean' = 'max'): ChartRow[] {
  const by = new Map<number, number[]>();
  for (const p of points) {
    if (p.value == null || !Number.isFinite(p.value)) continue;
    const k = Math.floor(p.ts / bucketMs) * bucketMs;
    const l = by.get(k);
    if (l) l.push(p.value); else by.set(k, [p.value]);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([from, v]) => ({ from, value: how === 'max' ? Math.max(...v) : Math.round(v.reduce((a, b) => a + b, 0) / v.length) }));
}

/** the bucket that suits a period: an hour for a day, six hours for a week, a day for longer */
export const bucketFor = (hours: number): number => (hours <= 24 ? 3_600_000 : hours <= 168 ? 6 * 3_600_000 : 86_400_000);

/** «Показать данные»: the same numbers as the chart, as a table (for a screen reader, for copying, for those who prefer figures) */
export default function ChartTable({ rows, valueLabel, bucketMs }: { rows: ChartRow[]; valueLabel: string; bucketMs: number }) {
  useI18n();
  if (rows.length === 0) return null;
  const fmt = (ts: number) => (bucketMs >= 86_400_000
    ? new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
  return (
    <details className="ct">
      <summary>{t('chart.data.show')}</summary>
      {/* a scrolling region has to be reachable with the keyboard (axe: scrollable-region-focusable) */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="ct-wrap" tabIndex={0} role="region" aria-label={t('chart.data.aria')}>
        <table>
          <thead><tr><th scope="col">{t('chart.data.time')}</th><th scope="col">{valueLabel}</th></tr></thead>
          <tbody>{[...rows].reverse().map((r) => <tr key={r.from}><td>{fmt(r.from)}</td><td className="tabular-nums">{r.value}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
