import type { ActivityItem } from '../../api';
import { t } from '../../i18n';
import { ago, fmtDateTime, IconClock, IconUsers, Section } from '../../ui';
import { isArray, useFetched } from './useFetched';

/** «Активность»: sessions on the servers and account events, newest first, with relative times */
export function ActivityFeed({ limit = 30 }: { limit?: number }) {
  const { data } = useFetched<ActivityItem[]>(`/me/activity?limit=${limit}`, isArray);
  if (data === null) return null;
  return (
    <Section title={t('pf.act.title')} description={t('pf.act.desc')}>
      {data === undefined && <div className="skeleton h-24 rounded-2xl bg-soft" />}
      {data && data.length === 0 && <p className="font-semibold text-mute">{t('pf.act.none')}</p>}
      {data && data.length > 0 && (
        <ul className="pf-line">
          {data.map((a, i) => (
            <li key={`${a.ts}-${i}`}>
              <span className="pf-dot" aria-hidden>{a.kind === 'session' ? <IconClock size={16} /> : <IconUsers size={16} />}</span>
              <div className="min-w-0 flex-1 pt-1">
                <div className="break-words font-bold">{a.text}</div>
                <div className="text-sm font-semibold text-mute" title={fmtDateTime(a.ts)}>{ago(a.ts)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
