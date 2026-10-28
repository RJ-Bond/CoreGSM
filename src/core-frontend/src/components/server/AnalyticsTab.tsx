/**
 * «Аналитика» of a server: who plays and when. Everything comes from GET /api/servers/:id/analytics (the poll history
 * and the players' visits the panel already keeps). The charts are plain SVG/CSS in the colour of the game.
 */
import { useEffect, useMemo, useState } from 'react';
import '../../styles/analytics.css';
import { api } from '../../api';
import { t, useI18n, type TKey } from '../../i18n';
import { rankById } from '../../vrisingRanks';
import { ago, ErrorLine, fmtDate, num } from '../../ui';
import NickPic from '../NickPic';
import { nickHue, nickInitial } from './helpers';

interface Analytics {
  days: number;
  timeZone: string;
  heatmap: {
    days: number;
    cells: (number | null)[][];
    peak: number[][];
    busiest: { dow: number; hour: number; avg: number } | null;
    quietest: { dow: number; hour: number; avg: number } | null;
    restartHour: number | null;
  };
  summary: {
    players: number; dau: number; wau: number; mau: number; newPlayers: number; returning: number; visits: number;
    avgMinutes: number | null; medianMinutes: number | null; playerHours: number;
  };
  daily: { day: string; players: number; newPlayers: number; hours: number; peak: number }[];
  sessions: { key: string; label: string; count: number }[];
  cohorts: { start: number; size: number; rates: number[] }[];
  top: { name: string; hours: number; visits: number; lastSeen: number | null; rankId?: string }[];
}

const DOW: TKey[] = ['cm.dow.0', 'cm.dow.1', 'cm.dow.2', 'cm.dow.3', 'cm.dow.4', 'cm.dow.5', 'cm.dow.6'];
const DOW_LONG: TKey[] = ['d2.an.dl.0', 'd2.an.dl.1', 'd2.an.dl.2', 'd2.an.dl.3', 'd2.an.dl.4', 'd2.an.dl.5', 'd2.an.dl.6'];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const minutesText = (m: number | null) => (m == null ? '–' : m < 60 ? t('dur.m', { n: m }) : m % 60 ? t('dur.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('dur.h', { n: Math.floor(m / 60) }));
const dayLabel = (d: string) => {
  const [, m, day] = d.split('-');
  return `${Number(day)}.${m}`;
};

function PeriodSwitch({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  useI18n();
  return (
    <div className="seg" role="group" aria-label={t('st.range')}>
      {[7, 30, 90].map((d) => (
        <button key={d} type="button" className="seg-item" aria-pressed={days === d} onClick={() => onChange(d)}>{t('d2.an.dShort', { n: d })}</button>
      ))}
    </div>
  );
}

function Kpi({ k, v, hint }: { k: string; v: string | number; hint?: string }) {
  return (
    <div className="an-kpi">
      <div className="an-kpi-k">{k}</div>
      <div className="an-kpi-v">{v}</div>
      {hint && <div className="an-kpi-h">{hint}</div>}
    </div>
  );
}

/** weekday x hour: the darker the cell, the more players on average */
function Heatmap({ h }: { h: Analytics['heatmap'] }) {
  useI18n();
  const [hover, setHover] = useState<{ dow: number; hour: number } | null>(null);
  const max = Math.max(1, ...h.cells.flat().map((v) => v ?? 0));
  const cur = hover ? { avg: h.cells[hover.dow][hover.hour], peak: h.peak[hover.dow][hover.hour] } : null;
  return (
    <div>
      <div className="an-heat" role="img" aria-label={h.busiest ? t('d2.an.busiestLabel', { when: t('d2.an.dayAt', { day: t(DOW_LONG[h.busiest.dow]), time: hh(h.busiest.hour) }) }) : t('d2.pl.fewData')} onMouseLeave={() => setHover(null)}>
        <span />
        {Array.from({ length: 24 }, (_, i) => <span key={i} className="an-heat-hour">{i % 3 === 0 ? i : ''}</span>)}
        {h.cells.map((row, dow) => (
          <div key={dow} className="contents">
            <span className="an-heat-dow">{t(DOW[dow])}</span>
            {row.map((v, hour) => (
              <span
                key={hour}
                className={`an-heat-cell ${v == null ? 'is-empty' : ''} ${hover?.dow === dow && hover.hour === hour ? 'is-hover' : ''}`}
                style={v == null ? undefined : { ['--a' as string]: (0.1 + 0.9 * (v / max)).toFixed(3) }}
                onMouseEnter={() => setHover({ dow, hour })}
                title={v == null ? t('d2.sys.noData') : t('d2.an.cell', { day: t(DOW[dow]), time: hh(hour), avg: v, peak: h.peak[dow][hour] })}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="an-heat-foot">
        <span className="an-heat-scale" aria-hidden>
          {t('d2.an.less')} <i style={{ ['--a' as string]: 0.15 }} /><i style={{ ['--a' as string]: 0.4 }} /><i style={{ ['--a' as string]: 0.7 }} /><i style={{ ['--a' as string]: 1 }} /> {t('d2.an.more')}
        </span>
        <span className="font-bold text-ink" aria-live="polite">
          {hover && cur ? (cur.avg == null ? t('d2.an.cellNone', { day: t(DOW[hover.dow]), time: hh(hover.hour) }) : t('d2.an.cell', { day: t(DOW[hover.dow]), time: hh(hover.hour), avg: num(cur.avg), peak: cur.peak })) : t('d2.an.avgFor', { n: h.days })}
        </span>
      </div>
      <div className="an-facts">
        {h.busiest && <p><b>{t('d2.an.peak')}</b> {t('d2.an.dayAt', { day: t(DOW_LONG[h.busiest.dow]), time: hh(h.busiest.hour) })}: {t('d2.an.avgPlayers', { n: Math.round(h.busiest.avg), avg: num(h.busiest.avg) })}</p>}
        {h.quietest && <p><b>{t('d2.an.quietest')}</b> {t('d2.an.dayAt', { day: t(DOW_LONG[h.quietest.dow]), time: hh(h.quietest.hour) })}</p>}
        {h.restartHour != null && <p><b>{t('d2.an.restart')}</b> {t('d2.an.restartText', { time: hh(h.restartHour) })}</p>}
      </div>
    </div>
  );
}

/** unique players per day: returning (accent) and new (lighter) stacked */
function DailyBars({ daily }: { daily: Analytics['daily'] }) {
  useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.players));
  const d = hover != null ? daily[hover] : null;
  const step = Math.ceil(daily.length / 8);
  return (
    <div>
      <div className="an-bars" role="img" aria-label={t('d2.an.uniqueLabel', { max })} onMouseLeave={() => setHover(null)}>
        {daily.map((x, i) => (
          <div key={x.day} className={`an-bar ${hover === i ? 'is-hover' : ''}`} onMouseEnter={() => setHover(i)} title={t('d2.an.barTitle', { day: dayLabel(x.day), players: x.players, fresh: x.newPlayers })}>
            <span className="an-bar-new" style={{ height: `${(x.newPlayers / max) * 100}%` }} />
            <span className="an-bar-old" style={{ height: `${((x.players - x.newPlayers) / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="an-bars-axis" aria-hidden>
        {/* every step-th day; the last one only when it does not run into the label before it */}
        {daily.map((x, i) => <span key={x.day}>{i % step === 0 || (i === daily.length - 1 && i % step >= step / 2) ? dayLabel(x.day) : ''}</span>)}
      </div>
      <div className="an-heat-foot">
        <span className="flex flex-wrap gap-3">
          <span className="an-legend"><i className="an-bar-old" />{t('d2.an.returned')}</span>
          <span className="an-legend"><i className="an-bar-new" />{t('d2.an.fresh')}</span>
        </span>
        <span className="font-bold text-ink" aria-live="polite">
          {d ? t('d2.an.dayLine', { n: d.players, day: dayLabel(d.day), fresh: d.newPlayers, hours: num(d.hours), peak: d.peak }) : t('d2.an.hoverBar')}
        </span>
      </div>
    </div>
  );
}

function SessionBars({ sessions }: { sessions: Analytics['sessions'] }) {
  const total = sessions.reduce((a, b) => a + b.count, 0);
  const max = Math.max(1, ...sessions.map((s) => s.count));
  return (
    <ul className="space-y-2">
      {sessions.map((s) => (
        <li key={s.key} className="an-hbar">
          <span className="an-hbar-k">{s.label}</span>
          <span className="an-hbar-track"><span style={{ width: `${(s.count / max) * 100}%` }} /></span>
          <span className="an-hbar-v">{total ? Math.round((s.count / total) * 100) : 0}%</span>
        </li>
      ))}
    </ul>
  );
}

/** of the players first seen in a week, the share that came back 1, 2 ... weeks later */
function Cohorts({ cohorts }: { cohorts: Analytics['cohorts'] }) {
  useI18n();
  const width = Math.max(1, ...cohorts.map((c) => c.rates.length));
  if (!cohorts.some((c) => c.size > 0)) return <p className="text-sm font-semibold text-mute">{t('d2.an.noNew')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="an-cohorts">
        <thead>
          <tr>
            <th scope="col">{t('d2.an.firstWeek')}</th>
            <th scope="col">{t('d2.an.players')}</th>
            {Array.from({ length: width }, (_, i) => <th key={i} scope="col">{t('d2.an.plusWeeks', { n: i + 1 })}</th>)}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.start}>
              <th scope="row">{t('d2.an.since', { date: fmtDate(c.start) })}</th>
              <td className="font-extrabold">{c.size}</td>
              {Array.from({ length: width }, (_, i) => {
                const v = c.rates[i];
                return v == null || !c.size
                  ? <td key={i} className="is-empty" />
                  : <td key={i} style={{ ['--a' as string]: (0.08 + 0.92 * (v / 100)).toFixed(3) }} className={v >= 55 ? 'is-strong' : ''}>{v}%</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TopSort = 'hours' | 'visits' | 'recent';
const TOP_SORTS: [TopSort, TKey][] = [['hours', 'd2.an.byHours'], ['visits', 'd2.an.byVisits'], ['recent', 'd2.an.byRecent']];

function TopPlayers({ top }: { top: Analytics['top'] }) {
  useI18n();
  const [sort, setSort] = useState<TopSort>('hours');
  const list = useMemo(
    () => [...top].sort((a, b) => (sort === 'visits' ? b.visits - a.visits || b.hours - a.hours : sort === 'recent' ? (b.lastSeen ?? Infinity) - (a.lastSeen ?? Infinity) : b.hours - a.hours)),
    [top, sort],
  );
  const max = Math.max(1, ...top.map((p) => (sort === 'visits' ? p.visits : p.hours)));
  if (!top.length) return <p className="text-sm font-semibold text-mute">{t('d2.an.nobody')}</p>;
  return (
    <div className="space-y-3">
      <div className="seg" role="group" aria-label={t('d2.an.order')}>
        {TOP_SORTS.map(([k, label]) => <button key={k} type="button" className="seg-item" aria-pressed={sort === k} onClick={() => setSort(k)}>{t(label)}</button>)}
      </div>
      <ol className="an-top">
        {list.map((p, i) => {
          const rank = p.rankId ? rankById(p.rankId) : null;
          const value = sort === 'visits' ? p.visits : p.hours;
          return (
            <li key={p.name}>
              <span className={`an-top-n ${i < 3 && sort !== 'recent' ? `is-${i + 1}` : ''}`}>{i + 1}</span>
              <NickPic name={p.name} size={32} className="rounded-full">
                <span className="avatar-hue grid shrink-0 place-items-center rounded-full font-extrabold" style={{ ['--h' as string]: nickHue(p.name), width: 32, height: 32, fontSize: 13 }} aria-hidden>{nickInitial(p.name)}</span>
              </NickPic>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <a className="truncate font-extrabold hover:underline" href={`/player/${encodeURIComponent(p.name)}`}>{p.name}</a>
                  {rank && <span className="truncate text-xs font-bold text-mute">{rank.name}</span>}
                </span>
                <span className="an-top-bar"><span style={{ width: `${(value / max) * 100}%` }} /></span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-extrabold tabular-nums">{sort === 'visits' ? t('d2.pl.nVisits', { n: p.visits }) : t('dur.h', { n: num(p.hours) })}</span>
                <span className="block text-xs font-bold text-mute">{p.lastSeen ? ago(p.lastSeen) : t('d2.pl.inGame')}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function AnalyticsTab({ id }: { id: number }) {
  useI18n();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setError('');
    api<Analytics>(`/servers/${id}/analytics?days=${days}`)
      .then((d) => { if (alive) setData(d); })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [id, days]);

  const s = data?.summary;
  const newShare = useMemo(() => (s && s.players ? Math.round((s.newPlayers / s.players) * 100) : 0), [s]);

  if (error) return <ErrorLine text={error} />;
  if (!data || !s) return <div className="tile skeleton h-72" aria-label={t('d2.an.loading')} role="status" />;

  return (
    <div className="an space-y-3.5">
      <section className="tile tile-in p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-extrabold">{t('d2.an.playersFor', { n: days })}</h2>
          <PeriodSwitch days={days} onChange={setDays} />
        </div>
        <div className="an-kpis">
          <Kpi k={t('d2.an.k.unique')} v={s.players} hint={t('d2.an.k.uniqueHint', { dau: s.dau, wau: s.wau, mau: s.mau })} />
          <Kpi k={t('d2.an.k.new')} v={s.newPlayers} hint={s.players ? t('d2.an.k.newHint', { p: newShare, n: s.returning }) : undefined} />
          <Kpi k={t('d2.an.k.visit')} v={minutesText(s.medianMinutes)} hint={s.avgMinutes != null ? t('d2.an.k.visitHint', { avg: minutesText(s.avgMinutes), visits: t('d2.pl.nVisits', { n: s.visits }) }) : undefined} />
          <Kpi k={t('d2.an.k.hours')} v={s.playerHours.toLocaleString('ru-RU')} hint={t('d2.an.k.hoursHint')} />
        </div>
      </section>

      <section className="tile tile-in p-4 sm:p-5">
        <h2 className="mb-3 text-base font-extrabold">{t('d2.an.when')}</h2>
        <Heatmap h={data.heatmap} />
      </section>

      <div className="grid gap-3.5 lg:grid-cols-12">
        <section className="tile tile-in p-4 sm:p-5 lg:col-span-7">
          <h2 className="mb-3 text-base font-extrabold">{t('d2.an.byDay')}</h2>
          <DailyBars daily={data.daily} />
        </section>
        <section className="tile tile-in p-4 sm:p-5 lg:col-span-5">
          <h2 className="mb-3 text-base font-extrabold">{t('d2.an.sessionLen')}</h2>
          <SessionBars sessions={data.sessions} />
        </section>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-12">
        <section className="tile tile-in p-4 sm:p-5 lg:col-span-7">
          <h2 className="mb-1 text-base font-extrabold">{t('d2.an.retention')}</h2>
          <p className="mb-3 text-sm font-semibold text-mute">{t('d2.an.retentionText')}</p>
          <Cohorts cohorts={data.cohorts} />
        </section>
        <section className="tile tile-in p-4 sm:p-5 lg:col-span-5">
          <h2 className="mb-3 text-base font-extrabold">{t('d2.an.topTitle')}</h2>
          <TopPlayers top={data.top} />
        </section>
      </div>
    </div>
  );
}
