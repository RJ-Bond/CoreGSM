import { useEffect, useState } from 'react';
import type { MyStats } from '../../api';
import { t } from '../../i18n';
import { ago, fmtDay, fmtDateTime, GameAvatar, Section } from '../../ui';
import { fmtDuration } from './format';
import { isObject, useFetched } from './useFetched';

const valid = (v: unknown) => isObject(v) && Array.isArray((v as MyStats).byDay);

/** statistics of the signed-in player for the last `days` days; `data` null = the API is unavailable */
export function useMyStats(days: number) {
  return useFetched<MyStats>(`/me/stats?days=${days}`, valid);
}

export const PERIODS = [7, 30, 90] as const;

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="pf-tile">
      <div className="pf-tile-v">{value}</div>
      <div className="pf-tile-l">{label}</div>
    </div>
  );
}

/** the five numbers of a period: hours online, sessions, streak, longest session, favourite server */
export function StatTiles({ s, compact = false }: { s: MyStats; compact?: boolean }) {
  const fav = s.byServer?.find((x) => x.serverId === s.favouriteServerId)?.name;
  return (
    <div className="pf-tiles">
      <Tile value={fmtDuration(s.totalSeconds)} label={t('pf.stats.online')} />
      <Tile value={String(s.sessions)} label={t('pf.stats.sessions')} />
      <Tile value={t('pf.stats.days', { n: s.streakDays })} label={t('pf.stats.streak')} />
      {!compact && <Tile value={fmtDuration(s.longestSessionSec)} label={t('pf.stats.longest')} />}
      {!compact && <Tile value={fav ?? '–'} label={t('pf.stats.favourite')} />}
    </div>
  );
}

const levelOf = (sec: number, max: number) => {
  if (sec <= 0 || max <= 0) return 0;
  const k = sec / max;
  return k > 0.75 ? 4 : k > 0.5 ? 3 : k > 0.25 ? 2 : 1;
};

/** day squares coloured by hours, a column per week (Monday on top), like a contribution calendar */
export function ActivityStrip({ byDay }: { byDay: MyStats['byDay'] }) {
  if (byDay.length === 0) return null;
  const max = Math.max(0, ...byDay.map((d) => d.seconds));
  // number of empty cells before the first day so that rows are weekdays (Mon = 0)
  const first = new Date(`${byDay[0].date}T00:00:00Z`);
  const lead = Number.isNaN(first.getTime()) ? 0 : (first.getUTCDay() + 6) % 7;
  const total = byDay.reduce((a, d) => a + d.seconds, 0);
  const active = byDay.filter((d) => d.seconds > 0).length;
  return (
    <div>
      <div className="pf-cal-wrap">
        <div className="pf-cal" role="img" aria-label={t('pf.stats.stripAria', { days: byDay.length, active, time: fmtDuration(total) })}>
          {Array.from({ length: lead }, (_, i) => <div key={`p${i}`} className="pf-cell pf-pad" aria-hidden />)}
          {byDay.map((d) => (
            <div key={d.date} className={`pf-cell pf-l${levelOf(d.seconds, max)}`} title={`${fmtDay(d.date)}: ${d.seconds > 0 ? fmtDuration(d.seconds) : t('pf.stats.noPlay')}`} />
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-mute">
        <span>{t('pf.stats.less')}</span>
        <span className="pf-legend" aria-hidden>{[0, 1, 2, 3, 4].map((l) => <span key={l} className={`pf-cell pf-l${l}`} />)}</span>
        <span>{t('pf.stats.more')}</span>
      </div>
    </div>
  );
}

/** play time by hour of the day: 24 static bars */
export function HourlyBars({ hourly }: { hourly: number[] }) {
  const data = Array.from({ length: 24 }, (_, i) => (Number.isFinite(hourly[i]) ? Math.max(0, hourly[i]) : 0));
  const max = Math.max(...data);
  if (max <= 0) return <p className="font-semibold text-mute">{t('pf.stats.noData')}</p>;
  const peak = data.indexOf(max);
  return (
    <div>
      <div className="pf-hours" role="img" aria-label={t('pf.stats.hoursAria', { h: peak })}>
        {data.map((v, h) => (
          <i key={h} className={h === peak ? 'pf-peak' : ''} style={{ height: `${Math.max(3, Math.round((v / max) * 100))}%` }} title={`${String(h).padStart(2, '0')}:00 · ${fmtDuration(v)}`} />
        ))}
      </div>
      <div className="pf-hours-axis" aria-hidden>
        <span>00</span><span>06</span><span>12</span><span>18</span>
      </div>
    </div>
  );
}

function ServerBars({ rows }: { rows: MyStats['byServer'] }) {
  if (rows.length === 0) return <p className="font-semibold text-mute">{t('pf.stats.noServers')}</p>;
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.serverId} className="flex items-center gap-3">
          <GameAvatar game={r.game} size={34} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <a href={`/servers/${r.serverId}`} className="min-w-0 truncate font-extrabold hover:underline">{r.name}</a>
              <span className="shrink-0 text-sm font-bold text-mute">{fmtDuration(r.seconds)}</span>
            </div>
            <div className="pf-bar pf-bar-lg mt-1" role="img" aria-label={`${r.name}: ${fmtDuration(r.seconds)}`}><i style={{ width: `${Math.max(2, (r.seconds / max) * 100)}%` }} /></div>
            <div className="mt-0.5 text-xs font-bold text-mute">{t('pf.stats.sessionsN', { n: r.sessions })}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** «Статистика игрока»: period switch, five numbers, per-server bars, activity strip and the hour histogram */
export function StatsPanel() {
  const [days, setDays] = useState<number>(30);
  const main = useMyStats(days);
  // the strip always shows at least a month, also for the 7-day period
  const stripDays = Math.max(30, days);
  const wide = useMyStats(stripDays);
  const [lastGood, setLastGood] = useState<MyStats | null>(null);
  useEffect(() => { if (main.data) setLastGood(main.data); }, [main.data]);

  if (main.data === null && !lastGood) return null; // endpoint unavailable: the panel is hidden
  const s = main.data ?? lastGood;
  const stripData = wide.data ?? (stripDays === days ? s : null);

  return (
    <Section
      title={t('pf.stats.title')}
      description={s?.nick ? t('pf.stats.nick', { nick: s.nick }) : t('pf.stats.desc')}
      actions={
        <div className="seg" role="group" aria-label={t('pf.stats.period')}>
          {PERIODS.map((p) => (
            <button key={p} type="button" className="seg-item" aria-pressed={days === p} onClick={() => setDays(p)}>{t('pf.stats.periodN', { n: p })}</button>
          ))}
        </div>
      }
    >
      {!s ? (
        <div className="skeleton h-32 rounded-2xl bg-soft" />
      ) : (
        <>
          <StatTiles s={s} />
          {s.lastSeenAt ? <p className="text-sm font-semibold text-mute">{t('pf.stats.lastSeen', { when: ago(s.lastSeenAt) })} <span className="sr-only">{fmtDateTime(s.lastSeenAt)}</span></p> : null}
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              <h3 className="font-black">{t('pf.stats.byServer')}</h3>
              <ServerBars rows={s.byServer ?? []} />
            </div>
            <div className="space-y-5">
              <div className="space-y-3">
                <h3 className="font-black">{t('pf.stats.strip', { n: stripDays })}</h3>
                {stripData ? <ActivityStrip byDay={stripData.byDay ?? []} /> : <div className="skeleton h-24 rounded-2xl bg-soft" />}
              </div>
              <div className="space-y-3">
                <h3 className="font-black">{t('pf.stats.byHour')}</h3>
                <HourlyBars hourly={s.hourly ?? []} />
              </div>
            </div>
          </div>
        </>
      )}
    </Section>
  );
}

/** a compact summary for the overview tab: the 30-day numbers, no charts */
export function StatsSummary() {
  const { data } = useMyStats(30);
  if (data === null) return null;
  return (
    <Section title={t('pf.sum.title')} description={t('pf.sum.desc')} actions={<a href="/profile/player" className="text-sm font-extrabold text-link hover:underline">{t('pf.sum.more')}</a>}>
      {data ? <StatTiles s={data} compact /> : <div className="skeleton h-20 rounded-2xl bg-soft" />}
    </Section>
  );
}
