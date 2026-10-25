import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { fmtDateTime, num } from '../../ui';
import { capLevel } from '../servers/capacity';
import { downsample, metricFill, trendPct } from './serverLogic';

export interface MetricsData {
  online: boolean;
  hasStatus: boolean;
  players: number;
  maxPlayers: number;
  peak: number | null;
  peakAt: number | null;
  uptimePct: number | null;
  avg: number | null;
  samples: number;
  /** «за 24 часа» */
  windowLabel: string;
  /** player counts over the window: a sparkline and a trend arrow */
  series?: number[];
}

function Spark({ values }: { values: number[] }) {
  const v = downsample(values, 28);
  const hi = Math.max(...v, 1);
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * 100).toFixed(1)},${(22 - (y / hi) * 20).toFixed(1)}`).join(' ');
  return (
    <svg className="srv-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Trend({ pct }: { pct: number }) {
  if (Math.abs(pct) < 3) return <span className="srv-trend is-flat" title="Без заметных изменений">→ ровно</span>;
  return <span className={`srv-trend ${pct > 0 ? 'is-up' : 'is-down'}`} title="Конец периода к его началу">{pct > 0 ? '↑' : '↓'} {Math.abs(pct)}%</span>;
}

function Cell({ k, v, hint, fill, level, spark, trend }: { k: string; v: ReactNode; hint?: ReactNode; fill: number; level?: 'ok' | 'good' | 'warm' | 'hot'; spark?: number[]; trend?: number | null }) {
  return (
    <div className="srv-metric">
      <div className="stat-k">{k}</div>
      <div className="srv-metric-v">{v}{trend != null && <Trend pct={trend} />}</div>
      {spark && spark.length > 3 && <Spark values={spark} />}
      <div className="srv-metric-bar" aria-hidden><i className={level ? `is-${level}` : undefined} style={{ width: `${fill}%` }} /></div>
      {hint != null && <div className="srv-metric-h">{hint}</div>}
    </div>
  );
}

/** uptime has its own scale: from 99 % it is good, 95–99 % is worth a look, below 95 % is bad */
export const uptimeLevel = (pct: number | null): 'good' | 'warm' | 'hot' | undefined => (pct == null ? undefined : pct >= 99 ? 'good' : pct >= 95 ? 'warm' : 'hot');

/** one compact row: Сейчас · Пик · Аптайм · В среднем (small value, a hint and a static mini bar).
 *  The bars speak in status colours (brand, then amber and red as a server fills up; green for good uptime),
 *  never in the cover's colour: a red cover must not make a healthy server look broken. */
export default function Metrics({ d, withSamples = false }: { d: MetricsData; withSamples?: boolean }) {
  useI18n();
  return (
    <div className={`srv-metrics ${withSamples ? 'has-4' : ''}`}>
      <Cell
        k="Пик"
        v={d.peak == null ? '–' : String(d.peak)}
        hint={d.peakAt ? fmtDateTime(d.peakAt) : undefined}
        fill={metricFill(d.peak, d.maxPlayers)}
        level={d.peak == null ? undefined : capLevel(metricFill(d.peak, d.maxPlayers))}
      />
      <Cell
        k="Аптайм"
        v={d.uptimePct == null ? '–' : `${num(d.uptimePct)}%`}
        hint={d.windowLabel}
        fill={d.uptimePct ?? 0}
        level={uptimeLevel(d.uptimePct)}
      />
      <Cell
        k="В среднем"
        spark={d.series}
        trend={d.series ? trendPct(d.series) : null}
        v={d.avg == null ? '–' : num(d.avg)}
        hint="пока онлайн"
        fill={metricFill(d.avg, d.maxPlayers)}
      />
      {withSamples && <Cell k="Измерений" v={String(d.samples)} hint={d.windowLabel} fill={0} />}
    </div>
  );
}
