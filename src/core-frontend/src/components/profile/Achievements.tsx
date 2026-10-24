import type { Achievement } from '../../api';
import { t } from '../../i18n';
import { fmtDate, Section } from '../../ui';
import { AchievementArt } from './icons';
import { isArray, useFetched } from './useFetched';

export function useAchievements() {
  return useFetched<Achievement[]>('/me/achievements', isArray);
}

const pct = (a: Achievement) => (a.target > 0 ? Math.max(0, Math.min(100, (a.progress / a.target) * 100)) : a.earned ? 100 : 0);

export function AchievementCard({ a }: { a: Achievement }) {
  return (
    <li className={`pf-ach ${a.earned ? 'is-on' : 'is-off'}`}>
      <span className="pf-ach-ico"><AchievementArt id={a.id} slug={a.icon} earned={a.earned} size={44} /></span>
      <div className="min-w-0 flex-1">
        <div className="pf-ach-title wrap-break-word font-extrabold leading-tight">{a.title}</div>
        {a.description && <div className="mt-0.5 text-sm font-semibold text-mute">{a.description}</div>}
        {a.earned ? (
          <div className="mt-1.5 text-sm font-extrabold text-ok">
            {a.earnedAt ? t('pf.ach.earnedAt', { date: fmtDate(a.earnedAt) }) : t('pf.ach.earned')}
          </div>
        ) : (
          <div className="mt-2">
            <div className="pf-bar" role="progressbar" aria-valuemin={0} aria-valuemax={a.target} aria-valuenow={Math.min(a.progress, a.target)} aria-label={a.title}>
              <i style={{ width: `${pct(a)}%` }} />
            </div>
            <div className="mt-1 text-xs font-extrabold text-mute">{Math.round(a.progress)} / {a.target}</div>
          </div>
        )}
      </div>
    </li>
  );
}

/** full grid: earned ones in colour with the date, the others greyed out with a progress bar */
export function AchievementsGrid() {
  const { data } = useAchievements();
  if (data === null) return null;
  const list = data ?? [];
  const done = list.filter((a) => a.earned).length;
  return (
    <Section title={t('pf.ach.title')} description={data ? t('pf.ach.count', { done, total: list.length }) : undefined}>
      {data === undefined && <div className="skeleton h-32 rounded-2xl bg-soft" />}
      {data && list.length === 0 && <p className="font-semibold text-mute">{t('pf.ach.none')}</p>}
      {data && list.length > 0 && <ul className="pf-ach-grid">{list.map((a) => <AchievementCard key={a.id} a={a} />)}</ul>}
    </Section>
  );
}

/** overview tab: the earned ones (or the closest to earning), a link to the whole grid */
export function AchievementsPreview() {
  const { data } = useAchievements();
  if (data === null || (data && data.length === 0)) return null;
  const earned = (data ?? []).filter((a) => a.earned).sort((x, y) => (y.earnedAt ?? 0) - (x.earnedAt ?? 0));
  const next = (data ?? []).filter((a) => !a.earned).sort((x, y) => pct(y) - pct(x))[0];
  return (
    <Section title={t('pf.ach.title')} actions={<a href="/profile/player" className="text-sm font-extrabold text-link hover:underline">{t('pf.ach.all')}</a>}>
      {data === undefined && <div className="skeleton h-16 rounded-2xl bg-soft" />}
      {data && earned.length === 0 && <p className="font-semibold text-mute">{t('pf.ach.noneYet')}</p>}
      {earned.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {earned.slice(0, 8).map((a) => (
            <li key={a.id} className="pf-ach-mini" title={a.description}>
              <span><AchievementArt id={a.id} slug={a.icon} size={26} /></span>
              <span className="pr-1">{a.title}</span>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <div className="rounded-2xl bg-soft px-4 py-3">
          <div className="flex items-baseline justify-between gap-3 text-sm font-extrabold">
            <span className="min-w-0 truncate">{t('pf.ach.next', { title: next.title })}</span>
            <span className="shrink-0 text-mute">{Math.round(next.progress)} / {next.target}</span>
          </div>
          <div className="pf-bar mt-2"><i style={{ width: `${pct(next)}%` }} /></div>
        </div>
      )}
    </Section>
  );
}
