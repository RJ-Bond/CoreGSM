/**
 * «Аналитика» of a server: who plays and when. Everything comes from GET /api/servers/:id/analytics (the poll history
 * and the players' visits the panel already keeps). The charts are plain SVG/CSS in the colour of the game.
 */
import { useEffect, useMemo, useState } from 'react';
import '../../styles/analytics.css';
import { api } from '../../api';
import { rankById } from '../../vrisingRanks';
import { ago, ErrorLine, fmtDate, plural, num } from '../../ui';

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

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DOW_LONG = ['в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу', 'в воскресенье'];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const minutesText = (m: number | null) => (m == null ? '–' : m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60 ? `${m % 60} мин` : ''}`.trim());
const dayLabel = (d: string) => {
  const [, m, day] = d.split('-');
  return `${Number(day)}.${m}`;
};

function PeriodSwitch({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <div className="seg" role="group" aria-label="Период">
      {[7, 30, 90].map((d) => (
        <button key={d} type="button" className="seg-item" aria-pressed={days === d} onClick={() => onChange(d)}>{d} дн</button>
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
  const [hover, setHover] = useState<{ dow: number; hour: number } | null>(null);
  const max = Math.max(1, ...h.cells.flat().map((v) => v ?? 0));
  const cur = hover ? { avg: h.cells[hover.dow][hover.hour], peak: h.peak[hover.dow][hover.hour] } : null;
  return (
    <div>
      <div className="an-heat" role="img" aria-label={h.busiest ? `Больше всего игроков ${DOW_LONG[h.busiest.dow]} в ${hh(h.busiest.hour)}` : 'Пока мало данных'} onMouseLeave={() => setHover(null)}>
        <span />
        {Array.from({ length: 24 }, (_, i) => <span key={i} className="an-heat-hour">{i % 3 === 0 ? i : ''}</span>)}
        {h.cells.map((row, dow) => (
          <div key={dow} className="contents">
            <span className="an-heat-dow">{DOW[dow]}</span>
            {row.map((v, hour) => (
              <span
                key={hour}
                className={`an-heat-cell ${v == null ? 'is-empty' : ''} ${hover?.dow === dow && hover.hour === hour ? 'is-hover' : ''}`}
                style={v == null ? undefined : { ['--a' as string]: (0.1 + 0.9 * (v / max)).toFixed(3) }}
                onMouseEnter={() => setHover({ dow, hour })}
                title={v == null ? 'нет данных' : `${DOW[dow]} ${hh(hour)}: в среднем ${v}, максимум ${h.peak[dow][hour]}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="an-heat-foot">
        <span className="an-heat-scale" aria-hidden>
          меньше <i style={{ ['--a' as string]: 0.15 }} /><i style={{ ['--a' as string]: 0.4 }} /><i style={{ ['--a' as string]: 0.7 }} /><i style={{ ['--a' as string]: 1 }} /> больше
        </span>
        <span className="font-bold text-ink" aria-live="polite">
          {hover && cur ? (cur.avg == null ? `${DOW[hover.dow]} ${hh(hover.hour)}: нет данных` : `${DOW[hover.dow]} ${hh(hover.hour)}: в среднем ${num(cur.avg)}, максимум ${cur.peak}`) : `средние за ${h.days} ${plural(h.days, ['день', 'дня', 'дней'])}`}
        </span>
      </div>
      <div className="an-facts">
        {h.busiest && <p><b>Пик</b> {DOW_LONG[h.busiest.dow]} в {hh(h.busiest.hour)}: в среднем {num(h.busiest.avg)} {plural(Math.round(h.busiest.avg), ['игрок', 'игрока', 'игроков'])}</p>}
        {h.quietest && <p><b>Тише всего</b> {DOW_LONG[h.quietest.dow]} в {hh(h.quietest.hour)}</p>}
        {h.restartHour != null && <p><b>Рестарт</b> лучше всего в {hh(h.restartHour)}: в это время меньше всего игроков в любой день</p>}
      </div>
    </div>
  );
}

/** unique players per day: returning (accent) and new (lighter) stacked */
function DailyBars({ daily }: { daily: Analytics['daily'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.players));
  const d = hover != null ? daily[hover] : null;
  const step = Math.ceil(daily.length / 8);
  return (
    <div>
      <div className="an-bars" role="img" aria-label={`Уникальных игроков в день: до ${max}`} onMouseLeave={() => setHover(null)}>
        {daily.map((x, i) => (
          <div key={x.day} className={`an-bar ${hover === i ? 'is-hover' : ''}`} onMouseEnter={() => setHover(i)} title={`${dayLabel(x.day)}: ${x.players} игроков, новых ${x.newPlayers}`}>
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
          <span className="an-legend"><i className="an-bar-old" />вернулись</span>
          <span className="an-legend"><i className="an-bar-new" />новые</span>
        </span>
        <span className="font-bold text-ink" aria-live="polite">
          {d ? `${dayLabel(d.day)}: ${d.players} ${plural(d.players, ['игрок', 'игрока', 'игроков'])}, новых ${d.newPlayers}, ${num(d.hours)} ч в игре, пик ${d.peak}` : 'наведите на столбец'}
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
  const width = Math.max(1, ...cohorts.map((c) => c.rates.length));
  if (!cohorts.some((c) => c.size > 0)) return <p className="text-sm font-semibold text-mute">Новых игроков за шесть недель не было.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="an-cohorts">
        <thead>
          <tr>
            <th scope="col">Неделя первого входа</th>
            <th scope="col">Игроков</th>
            {Array.from({ length: width }, (_, i) => <th key={i} scope="col">+{i + 1} нед</th>)}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.start}>
              <th scope="row">с {fmtDate(c.start)}</th>
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

function TopPlayers({ top }: { top: Analytics['top'] }) {
  const max = Math.max(1, ...top.map((p) => p.hours));
  if (!top.length) return <p className="text-sm font-semibold text-mute">За этот период никто не играл.</p>;
  return (
    <ol className="an-top">
      {top.map((p, i) => {
        const rank = p.rankId ? rankById(p.rankId) : null;
        return (
          <li key={p.name}>
            <span className={`an-top-n ${i < 3 ? `is-${i + 1}` : ''}`}>{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate font-extrabold">{p.name}</span>
                {rank && <span className="truncate text-xs font-bold text-mute">{rank.name}</span>}
              </span>
              <span className="an-top-bar"><span style={{ width: `${(p.hours / max) * 100}%` }} /></span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-extrabold tabular-nums">{num(p.hours)} ч</span>
              <span className="block text-xs font-bold text-mute">{p.lastSeen ? ago(p.lastSeen) : 'сейчас в игре'}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function AnalyticsTab({ id }: { id: number }) {
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
  if (!data || !s) return <div className="tile skeleton h-72" aria-label="Загрузка аналитики" role="status" />;

  return (
    <div className="an space-y-3.5">
      <section className="tile tile-in p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-extrabold">Игроки за {days} {plural(days, ['день', 'дня', 'дней'])}</h2>
          <PeriodSwitch days={days} onChange={setDays} />
        </div>
        <div className="an-kpis">
          <Kpi k="Уникальных игроков" v={s.players} hint={`сегодня ${s.dau} · за неделю ${s.wau} · за месяц ${s.mau}`} />
          <Kpi k="Новых" v={s.newPlayers} hint={s.players ? `${newShare}% от всех, вернулись ${s.returning}` : undefined} />
          <Kpi k="Обычный визит" v={minutesText(s.medianMinutes)} hint={s.avgMinutes != null ? `в среднем ${minutesText(s.avgMinutes)} · ${s.visits} ${plural(s.visits, ['визит', 'визита', 'визитов'])}` : undefined} />
          <Kpi k="Часов в игре" v={s.playerHours.toLocaleString('ru-RU')} hint="все игроки вместе" />
        </div>
      </section>

      <section className="tile tile-in p-4 sm:p-5">
        <h2 className="mb-3 text-base font-extrabold">Когда играют</h2>
        <Heatmap h={data.heatmap} />
      </section>

      <div className="grid gap-3.5 lg:grid-cols-12">
        <section className="tile tile-in p-4 sm:p-5 lg:col-span-7">
          <h2 className="mb-3 text-base font-extrabold">Игроки по дням</h2>
          <DailyBars daily={data.daily} />
        </section>
        <section className="tile tile-in p-4 sm:p-5 lg:col-span-5">
          <h2 className="mb-3 text-base font-extrabold">Сколько длится визит</h2>
          <SessionBars sessions={data.sessions} />
        </section>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-12">
        <section className="tile tile-in p-4 sm:p-5 lg:col-span-7">
          <h2 className="mb-1 text-base font-extrabold">Возвращаются ли новички</h2>
          <p className="mb-3 text-sm font-semibold text-mute">Доля игроков, впервые зашедших в эту неделю, которые вернулись через одну, две и больше недель.</p>
          <Cohorts cohorts={data.cohorts} />
        </section>
        <section className="tile tile-in p-4 sm:p-5 lg:col-span-5">
          <h2 className="mb-3 text-base font-extrabold">Больше всех в игре</h2>
          <TopPlayers top={data.top} />
        </section>
      </div>
    </div>
  );
}
