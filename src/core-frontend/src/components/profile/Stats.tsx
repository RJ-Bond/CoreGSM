import { useEffect, useState } from 'react';
import { StatTile, IcoClock, IcoFlame, IcoHeart, IcoPlay, IcoTimer } from './bits';
import type { MyStats } from '../../api';
import { t } from '../../i18n';
import { ago, Empty, fmtDay, fmtDateTime, GameAvatar, Section } from '../../ui';
import { fmtDuration } from './format';
import { isObject, useFetched } from './useFetched';

const valid = (v: unknown) => isObject(v) && Array.isArray((v as MyStats).byDay);

/** statistics of the signed-in player for the last `days` days; `data` null = the API is unavailable */
export function useMyStats(days: number) {
  return useFetched<MyStats>(`/me/stats?days=${days}`, valid);
}

export const PERIODS = [7, 30, 90] as const;

/** the five numbers of a period: hours online, sessions, streak, longest session, favourite server */
export function StatTiles({ s, compact = false }: { s: MyStats; compact?: boolean }) {
  const fav = s.byServer?.find((x) => x.serverId === s.favouriteServerId)?.name;
  return (
    <div className="pf-tiles">
      <StatTile icon={<IcoClock />} value={fmtDuration(s.totalSeconds)} label={t('pf.stats.online')} />
      <StatTile icon={<IcoPlay />} value={String(s.sessions)} label={t('pf.stats.sessions')} />
      <StatTile icon={<IcoFlame />} hot={s.streakDays >= 7} value={t('pf.stats.days', { n: s.streakDays })} label={t('pf.stats.streak')} />
      {!compact && <StatTile icon={<IcoTimer />} value={fmtDuration(s.longestSessionSec)} label={t('pf.stats.longest')} />}
      {!compact && <StatTile icon={<IcoHeart />} value={fav ?? '–'} label={t('pf.stats.favourite')} />}
    </div>
  );
}

const levelOf = (sec: number, max: number) => {
  if (sec <= 0 || max <= 0) return 0;
  const k = sec / max;
  return k > 0.75 ? 4 : k > 0.5 ? 3 : k > 0.25 ? 2 : 1;
};

const CELL = 14, GAP = 4;
const MONDAY = new Date('2024-01-01T12:00:00Z');
const weekday = (row: number) => new Date(MONDAY.getTime() + row * 86_400_000).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });

/** day squares coloured by hours, a column per week (Monday on top), like a contribution calendar: month labels on top, weekdays on the left, a tooltip on hover or tap */
export function ActivityStrip({ byDay }: { byDay: MyStats['byDay'] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (byDay.length === 0) return null;
  const max = Math.max(0, ...byDay.map((d) => d.seconds));
  // number of empty cells before the first day so that rows are weekdays (Mon = 0)
  const first = new Date(`${byDay[0].date}T00:00:00Z`);
  const lead = Number.isNaN(first.getTime()) ? 0 : (first.getUTCDay() + 6) % 7;
  const total = byDay.reduce((a, d) => a + d.seconds, 0);
  const active = byDay.filter((d) => d.seconds > 0).length;
  const weeks = Math.ceil((lead + byDay.length) / 7);
  // the month label goes over the first column in which the month changes
  const months: (string | null)[] = Array.from({ length: weeks }, (_, w) => {
    const d = byDay[Math.max(0, w * 7 - lead)];
    const prev = byDay[Math.max(0, (w - 1) * 7 - lead)];
    if (!d) return null;
    const m = new Date(`${d.date}T12:00:00Z`);
    const pm = new Date(`${prev.date}T12:00:00Z`);
    if (w > 0 && m.getUTCMonth() === pm.getUTCMonth()) return null;
    return m.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }).replace('.', '');
  });
  const col = hover == null ? 0 : Math.floor((lead + hover) / 7);
  const row = hover == null ? 0 : (lead + hover) % 7;
  const h = hover != null ? byDay[hover] : null;
  return (
    <div>
      <div className="pf-cal-outer">
        <div className="pf-cal-days" aria-hidden>
          {[0, 2, 4].map((r) => <span key={r} style={{ gridRow: r + 1 }}>{weekday(r)}</span>)}
        </div>
        <div className="pf-cal-wrap" onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}>
          <div className="pf-cal-months" style={{ gridTemplateColumns: `repeat(${weeks}, ${CELL}px)` }} aria-hidden>
            {months.map((m, w) => <span key={w}>{m}</span>)}
          </div>
          <div className="pf-cal-body">
            <div className="pf-cal" role="img" aria-label={t('pf.stats.stripAria', { days: byDay.length, active, time: fmtDuration(total) })}>
              {Array.from({ length: lead }, (_, i) => <div key={`p${i}`} className="pf-cell pf-pad" aria-hidden />)}
              {byDay.map((d, i) => (
                <div
                  key={d.date}
                  className={`pf-cell pf-l${levelOf(d.seconds, max)} ${hover === i ? 'is-hover' : ''}`}
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(i); }}
                  onPointerDown={(e) => { if (e.pointerType !== 'mouse') setHover((c) => (c === i ? null : i)); }}
                />
              ))}
            </div>
            {h && (
              <div className={`pf-cal-tip ${col > weeks - 6 ? 'is-left' : ''}`} style={{ left: col > weeks - 6 ? col * (CELL + GAP) - 6 : col * (CELL + GAP) + CELL + 6, top: row * (CELL + GAP) + CELL / 2 }} aria-hidden>
                <b>{fmtDay(h.date)}</b>
                <span>{h.seconds > 0 ? fmtDuration(h.seconds) : t('pf.stats.noPlay')}</span>
              </div>
            )}
          </div>
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
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => <span key={h}>{String(h).padStart(2, '0')}</span>)}
      </div>
      <p className="mt-2 text-sm font-bold">{t('pf.stats.peak', { h: `${String(peak).padStart(2, '0')}:00` })}</p>
    </div>
  );
}

function ServerBars({ rows }: { rows: MyStats['byServer'] }) {
  if (rows.length === 0) return <p className="font-semibold text-mute">{t('pf.stats.noServers')}</p>;
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  const sum = Math.max(1, rows.reduce((a, r) => a + r.seconds, 0));
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.serverId} className="flex items-center gap-3">
          <GameAvatar game={r.game} size={34} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <a href={`/servers/${r.serverId}`} className="min-w-0 truncate font-extrabold hover:underline">{i === 0 && rows.length > 1 && <span className="pf-lead" aria-hidden>★ </span>}{r.name}</a>
              <span className="shrink-0 text-sm font-bold text-mute">{fmtDuration(r.seconds)} · {t('pf.stats.share', { p: Math.round((r.seconds / sum) * 100) })}</span>
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
      ) : s.totalSeconds <= 0 ? (
        <Empty title={t('pf.stats.empty', { days })} text={t('pf.stats.emptyText')}><a href="/servers" className="btn mt-2">{t('pf.stats.emptyBtn')}</a></Empty>
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

const dayKeys = () => {
  const d = new Date();
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return new Set([local, d.toISOString().slice(0, 10)]);
};

/** «Сегодня»: the time played today against yesterday */
function TodayBlock({ byDay }: { byDay: MyStats['byDay'] }) {
  const last = byDay[byDay.length - 1];
  if (!last || !dayKeys().has(last.date)) return null;
  const today = last.seconds;
  const yest = byDay[byDay.length - 2]?.seconds ?? 0;
  const diff = today - yest;
  const text = today <= 0 ? t('pf.today.none') : diff === 0 ? t('pf.today.same') : diff > 0 ? t('pf.today.up', { d: fmtDuration(diff) }) : t('pf.today.down', { d: fmtDuration(-diff) });
  return (
    <div className={`pf-today ${today > 0 && diff > 0 ? 'is-up' : ''}`}>
      <span className="pf-today-k">{t('pf.today.title')}</span>
      <span className="pf-today-v">{today > 0 ? fmtDuration(today) : '–'}</span>
      <span className="pf-today-d">{today > 0 && diff !== 0 && <span aria-hidden>{diff > 0 ? '▲ ' : '▼ '}</span>}{text}</span>
    </div>
  );
}

/** a compact summary for the overview tab: the 30-day numbers and today against yesterday, no charts */
export function StatsSummary({ data }: { data: MyStats | null | undefined }) {
  if (data === null) return null;
  return (
    <Section title={t('pf.sum.title')} description={t('pf.sum.desc')} actions={<a href="/profile/player" className="text-sm font-extrabold text-link hover:underline">{t('pf.sum.more')}</a>}>
      {data ? <><TodayBlock byDay={data.byDay ?? []} /><StatTiles s={data} compact /></> : <div className="skeleton h-20 rounded-2xl bg-soft" />}
    </Section>
  );
}
