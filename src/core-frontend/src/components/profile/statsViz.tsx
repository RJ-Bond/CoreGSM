import { t } from '../../i18n';
import { fmtDay } from '../../ui';
import { fmtDuration } from './format';
import { lastDaysMarks } from './heroLogic';

/** hours per day as a small area curve, so a tile shows the trend and not only the total */
export function DaySpark({ byDay }: { byDay: { seconds: number }[] }) {
  const vals = byDay.map((d) => d.seconds);
  if (vals.length < 3 || Math.max(...vals) <= 0) return null;
  const W = 120;
  const H = 28;
  const max = Math.max(...vals);
  const x = (i: number) => (i / (vals.length - 1)) * W;
  const y = (v: number) => H - 2 - (v / max) * (H - 6);
  const line = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="pf-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t('pf.stats.sparkAria')}>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} className="pf-spark-fill" />
      <path d={line} className="pf-spark-line" fill="none" pathLength={1} />
    </svg>
  );
}

/** the last two weeks as squares: a day with play is filled */
export function StreakStrip({ byDay, days = 14 }: { byDay: { seconds: number; date?: string }[]; days?: number }) {
  const marks = lastDaysMarks(byDay, days);
  if (marks.length === 0) return null;
  const rows = byDay.slice(-days);
  return (
    <div className="pf-strip" role="img" aria-label={t('pf.stats.streakAria', { n: marks.filter(Boolean).length, days: marks.length })}>
      {marks.map((on, i) => {
        const d = rows[i];
        const title = d?.date ? `${fmtDay(d.date)} · ${on ? fmtDuration(d.seconds) : t('pf.stats.noPlay')}` : undefined;
        return <i key={i} className={on ? 'is-on' : ''} title={title} />;
      })}
    </div>
  );
}
