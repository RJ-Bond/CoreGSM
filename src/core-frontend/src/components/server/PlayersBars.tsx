import { useMemo } from 'react';
import { t, useI18n } from '../../i18n';
import { bucketPeaks, highestBar, type BarPoint } from './barsLogic';

const clock = (ts: number) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const day = (ts: number) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

/**
 * The «Ember» chart of the players: a column for every hour (or six hours, or a day), the highest one in the accent colour
 * with a glow, the rest in graphite. A column says its time and its peak when the pointer is on it.
 */
export default function PlayersBars({ points, hours, max, now }: { points: BarPoint[]; hours: number; max: number; now: number }) {
  useI18n();
  const bars = useMemo(() => bucketPeaks(points, hours, now), [points, hours, now]);
  const top = highestBar(bars);
  const scale = Math.max(1, max, ...bars.map((b) => b.peak ?? 0));
  const label = (ts: number) => (hours <= 24 ? clock(ts) : day(ts));
  const where = (b: { from: number; to: number }) => (hours <= 24 ? `${clock(b.from)}–${clock(b.to)}` : `${day(b.from)}`);
  const summary = top >= 0 ? t('srv.bars.summary', { n: bars[top].peak ?? 0, when: where(bars[top]) }) : t('srv.bars.none');
  return (
    <div className="pb">
      <div className="pb-cols" role="img" aria-label={summary}>
        {bars.map((b, i) => (
          <i
            key={b.from}
            className={`pb-bar ${i === top ? 'is-top' : ''} ${b.peak == null ? 'is-empty' : ''}`}
            style={{ height: `${b.peak == null ? 4 : Math.max(6, Math.round((b.peak / scale) * 100))}%` }}
            title={b.peak == null ? `${where(b)} · ${t('srv.bars.noData')}` : `${where(b)} · ${t('srv.bars.peak', { n: b.peak })}`}
          />
        ))}
      </div>
      <div className="pb-ax" aria-hidden>
        <span>{label(bars[0].from)}</span>
        <span>{label(bars[Math.floor(bars.length / 4)].from)}</span>
        <span>{label(bars[Math.floor(bars.length / 2)].from)}</span>
        <span>{label(bars[Math.floor((bars.length * 3) / 4)].from)}</span>
        <span>{t('srv.bars.now')}</span>
      </div>
      <p className="pb-note">{summary}</p>
    </div>
  );
}
