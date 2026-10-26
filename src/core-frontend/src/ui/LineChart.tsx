import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { buildChart, nearestIndex, thin, type Pt } from '../healthChart';
import { t } from '../i18n';
import { fmtDateTime, fmtTime } from './format';

const W = 640;

/**
 * The line chart of the panel's own measurements (health, later others): a title with the current value, the line over an
 * area, an optional threshold, min / max underneath. Pointer and keyboard (← → Home End, Esc) read single points.
 * One component, so every chart has the same axes, tooltip and keyboard access.
 */
export function LineChart({ title, hint, points, fmt, limit, lowIsBad, floor, height = 150, className = '' }: {
  title: string;
  hint?: string;
  points: Pt[];
  fmt: (n: number) => string;
  /** a threshold drawn as a dashed line; the card turns red when the latest value is past it */
  limit?: number;
  /** the threshold is a minimum (free disk space), not a maximum */
  lowIsBad?: boolean;
  /** start the vertical range at the data minimum instead of zero */
  floor?: boolean;
  height?: number;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const shown = useMemo(() => thin(points, 160), [points]);
  const c = useMemo(() => buildChart(shown.map((p) => p.v), W, height, { limit, floor }), [shown, limit, floor, height]);
  const breach = c.last != null && limit != null && (lowIsBad ? c.last < limit : c.last > limit);
  const n = shown.length;
  const pt = active != null ? shown[active] : null;
  const span = n > 1 ? shown[n - 1].ts - shown[0].ts : 0;
  const when = (ts: number) => (span > 36 * 3600_000 ? fmtDateTime(ts) : fmtTime(ts));
  const xPct = (i: number) => (n <= 1 ? 50 : ((3 + (i / (n - 1)) * (W - 6)) / W) * 100);

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setActive(nearestIndex((e.clientX - r.left) / Math.max(1, r.width), n));
  };
  const key = (e: KeyboardEvent) => {
    const cur = active ?? n - 1;
    if (e.key === 'ArrowLeft') setActive(Math.max(0, cur - 1));
    else if (e.key === 'ArrowRight') setActive(Math.min(n - 1, cur + 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };
  const shownValue = pt?.v ?? c.last;

  return (
    <div className={`lc rounded-ui-lg bg-soft p-4 ${breach ? 'ring-2 ring-bad' : ''} ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-extrabold">{title}</h3>
        <span className={`text-xl font-black tabular-nums ${breach ? 'text-bad' : ''}`}>{shownValue == null ? '–' : fmt(shownValue)}</span>
      </div>
      {hint && <p className="text-fs-sm font-semibold text-mute">{hint}</p>}
      <div
        className="lc-plot relative mt-2 outline-offset-2"
        style={{ height }}
        tabIndex={c.empty ? undefined : 0}
        role="group"
        aria-label={c.empty ? t('hl.noData') : t('hl.chartAria', { title, now: fmt(c.last ?? 0), min: fmt(c.min), max: fmt(c.max) })}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setActive(null)}
        onKeyDown={key}
        onBlur={() => setActive(null)}
      >
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="block h-full w-full" aria-hidden>
          {!c.empty && <path d={c.area} className="fill-link" opacity="0.14" />}
          {!c.empty && <path d={c.path} fill="none" className="stroke-link" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
          {c.limitY != null && <line x1="0" x2={W} y1={c.limitY} y2={c.limitY} className="stroke-bad" strokeWidth="1.5" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />}
        </svg>
        {pt && (
          <>
            <span className="lc-cursor" style={{ left: `${xPct(active!)}%` }} aria-hidden />
            <span className="lc-tip" style={{ left: `${Math.max(14, Math.min(86, xPct(active!)))}%` }} aria-hidden>
              <b>{pt.v == null ? '–' : fmt(pt.v)}</b> · {when(pt.ts)}
            </span>
          </>
        )}
      </div>
      <div className="sr-only" aria-live="polite">{pt ? `${when(pt.ts)}: ${pt.v == null ? t('hl.noData') : fmt(pt.v)}` : ''}</div>
      {n > 1 && (
        <div className="lc-ticks mt-1 flex justify-between text-fs-2xs font-bold text-mute" aria-hidden>
          <span>{when(shown[0].ts)}</span><span>{when(shown[Math.floor(n / 2)].ts)}</span><span>{when(shown[n - 1].ts)}</span>
        </div>
      )}
      <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-fs-xs font-bold text-mute">
        <span>{c.empty ? t('hl.noData') : `${t('hl.min')} ${fmt(c.min)} · ${t('hl.max')} ${fmt(c.max)}`}</span>
        {limit != null && <span className="text-bad">{t(lowIsBad ? 'hl.limitLow' : 'hl.limit', { v: fmt(limit) })}</span>}
      </div>
    </div>
  );
}
