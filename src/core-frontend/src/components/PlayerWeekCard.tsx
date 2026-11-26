import { t, useI18n } from '../i18n';
import { CopyButton } from '../ui';
import { weekOf, type AchievementLike, type DaySeconds } from '../pages/playerWeek';

const n = (v: number) => v.toLocaleString([], { maximumFractionDigits: 1 });
const dayName = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString([], { weekday: 'long' });

/** the week of a player in a few figures, with a line to paste into a chat */
export default function PlayerWeekCard({ name, byDay, achievements }: { name: string; byDay: DaySeconds[]; achievements?: AchievementLike[] }) {
  useI18n();
  const w = weekOf(byDay, achievements);
  if (!w) return null;
  const max = Math.max(1, ...w.bars);
  const delta = Math.round((w.hours - w.before) * 10) / 10;
  const text = t('wk.share', { name, h: n(w.hours), d: w.days, link: `${window.location.origin}/player/${encodeURIComponent(name)}` });
  return (
    <section className="tile p-4 sm:p-5" aria-labelledby="wk-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="wk-title" className="text-lg font-extrabold">{t('wk.title')}</h2>
        <CopyButton text={text} label={t('wk.copy')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <dt className="t-caption">{t('wk.hours')}</dt>
            <dd className="t-num text-2xl">{t('dur.h', { n: n(w.hours) })}</dd>
            <dd className={`text-sm font-bold ${delta > 0 ? 'text-ok' : 'text-mute'}`}>{delta > 0 ? t('wk.more', { n: n(delta) }) : delta < 0 ? t('wk.less', { n: n(-delta) }) : t('wk.same')}</dd>
          </div>
          <div><dt className="t-caption">{t('wk.days')}</dt><dd className="t-num text-2xl">{t('wk.of7', { n: w.days })}</dd></div>
          {w.best && <div><dt className="t-caption">{t('wk.best')}</dt><dd className="t-num text-2xl capitalize">{dayName(w.best.date)}</dd><dd className="text-sm font-bold text-mute">{t('dur.h', { n: n(w.best.hours) })}</dd></div>}
          {w.achievements > 0 && <div><dt className="t-caption">{t('wk.ach')}</dt><dd className="t-num text-2xl">{w.achievements}</dd></div>}
        </dl>
        <div className="flex h-16 items-end gap-1.5" role="img" aria-label={t('wk.bars')}>
          {w.bars.map((v, i) => <span key={i} className="w-4 rounded-t bg-brand" style={{ height: `${Math.max(4, (v / max) * 100)}%`, opacity: v ? 1 : 0.25 }} title={t('dur.h', { n: n(v) })} />)}
        </div>
      </div>
    </section>
  );
}
