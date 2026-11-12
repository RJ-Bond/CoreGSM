import { useMemo } from 'react';
import { t, useI18n } from '../../i18n';
import { bucketPeaks, highestBar, type BarPoint } from './barsLogic';

const clock = (ts: number) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const day = (ts: number) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

/**
 * The «Ember» chart of the players: a column for every hour (or six hours, or a day), the highest one in the accent colour
 * with a glow, the rest in graphite. A column says its time and its peak when the pointer is on it.
 */
/** the usual number of players at this hour of this day of the week (the baseline of the server: 7 x 24 values, UTC) */
const usualAt = (baseline: (number | null)[] | null | undefined, ts: number): number | null => {
  if (!baseline) return null;
  const d = new Date(ts);
  return baseline[d.getUTCDay() * 24 + d.getUTCHours()] ?? null;
};

export default function PlayersBars({ points, hours, max, now, baseline = null }: { points: BarPoint[]; hours: number; max: number; now: number; baseline?: (number | null)[] | null }) {
  useI18n();
  const bars = useMemo(() => bucketPeaks(points, hours, now), [points, hours, now]);
  const top = highestBar(bars);
  const usual = hours <= 24 ? bars.map((b) => usualAt(baseline, (b.from + b.to) / 2)) : bars.map(() => null);
  const scale = Math.max(1, max, ...bars.map((b) => b.peak ?? 0), ...usual.map((u) => u ?? 0));
  const hasUsual = usual.some((u) => u != null);
  const seen = bars.map((b) => b.peak).filter((p): p is number => p != null);
  const avg = seen.length > 2 ? Math.round(seen.reduce((a, b) => a + b, 0) / seen.length) : null;
  const label = (ts: number) => (hours <= 24 ? clock(ts) : day(ts));
  const where = (b: { from: number; to: number }) => (hours <= 24 ? `${clock(b.from)}–${clock(b.to)}` : `${day(b.from)}`);
  const summary = top >= 0 ? t('srv.bars.summary', { n: bars[top].peak ?? 0, when: where(bars[top]) }) : t('srv.bars.none');
  return (
    <div className="pb">
      <div className="pb-cols" role="img" aria-label={summary}>
        <span className="pb-grid" style={{ bottom: '50%' }} aria-hidden><em>{Math.round(scale / 2)}</em></span>
        <span className="pb-grid" style={{ bottom: '100%' }} aria-hidden><em>{scale}</em></span>
        {avg != null && <span className="pb-avg" style={{ bottom: `${Math.max(2, Math.round((avg / scale) * 100))}%` }} aria-hidden><em>{t('srv.bars.avg', { n: avg })}</em></span>}
        {bars.map((b, i) => (
          <span key={b.from} className="pb-col" title={b.peak == null ? `${where(b)} · ${t('srv.bars.noData')}` : `${where(b)} · ${t('srv.bars.peak', { n: b.peak })}`}>
            {usual[i] != null && <s className="pb-ghost" style={{ bottom: `${Math.max(2, Math.round(((usual[i] as number) / scale) * 100))}%` }} aria-hidden />}
            <i
              className={`pb-bar ${i === top ? 'is-top' : ''} ${i === bars.length - 1 ? 'is-now' : ''} ${b.peak == null ? 'is-empty' : ''}`}
              style={{ height: `${b.peak == null ? 4 : Math.max(6, Math.round((b.peak / scale) * 100))}%` }}
            >
              {i === top && b.peak != null && <b className="pb-peak">{b.peak}</b>}
            </i>
          </span>
        ))}
      </div>
      <div className="pb-ax" aria-hidden>
        <span>{label(bars[0].from)}</span>
        <span>{label(bars[Math.floor(bars.length / 4)].from)}</span>
        <span>{label(bars[Math.floor(bars.length / 2)].from)}</span>
        <span>{label(bars[Math.floor((bars.length * 3) / 4)].from)}</span>
        <span>{t('srv.bars.now')}</span>
      </div>
      <p className="pb-note">{summary}{hasUsual && <span className="pb-key"><s aria-hidden />{t('srv.bars.usual')}</span>}</p>
    </div>
  );
}
