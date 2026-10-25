/**
 * The card of a player by the nick the game servers report (/player/<nick>): where they play, how much, at what
 * time of day, the streak of days in a row and the latest visits. Works without signing in on a public panel.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, type Achievement } from '../api';
import { ActivityStrip } from '../components/profile/Stats';
import NickPic from '../components/NickPic';
import { Crumbs } from '../components/ShellExtras';
import { AchievementCard } from '../components/profile/Achievements';
import { FollowButton } from '../components/profile/Follows';
import { rankById } from '../vrisingRanks';
import { Empty, ErrorLine, GameAvatar, ago, fmtDateTime, fmtTime, plural, num } from '../ui';
import '../styles/community.css';
import '../styles/profile.css';

interface PlayerCard {
  name: string;
  firstSeen: number;
  lastSeen: number | null;
  online: boolean;
  hours: number;
  visits: number;
  days: number;
  streak: number;
  usualHour: number | null;
  byHour: number[];
  /** the last 90 days, oldest first */
  byDay: { date: string; seconds: number }[];
  ranks: { week: number | null; weekBefore: number | null; month: number | null; all: number | null };
  servers: { id: number; name: string; game: string; hours: number; visits: number; last: number }[];
  recent: { serverId: number; serverName: string; from: number; to: number | null }[];
  rankId?: string;
  achievements?: Achievement[];
}

/** «№ 7 за неделю ▲2»: the place among all players, with the move against the week before */
function RankChip({ place, before, label }: { place: number | null; before?: number | null; label: string }) {
  if (place == null) return null;
  const d = before === undefined ? null : before == null ? 'new' : before - place;
  return (
    <span className="pl-place">
      <b>№ {place}</b> {label}
      {d === 'new' ? <i className="pl-move new">новый</i> : typeof d === 'number' && d !== 0 ? <i className={`pl-move ${d > 0 ? 'up' : 'down'}`}><span aria-hidden>{d > 0 ? '▲' : '▼'}</span>{Math.abs(d)}</i> : null}
    </span>
  );
}

const partOfDay = (h: number) => (h < 6 ? 'ночью' : h < 12 ? 'утром' : h < 18 ? 'днём' : 'вечером');

export default function PlayerPage({ name }: { name: string }) {
  const [p, setP] = useState<PlayerCard | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setP(null);
    setMissing(false);
    api<PlayerCard>(`/players/${encodeURIComponent(name)}`)
      .then(setP)
      .catch((e: Error) => (e instanceof ApiError && e.status === 404 ? setMissing(true) : setError(e.message)));
  }, [name]);

  if (missing) return <Empty title="Такого игрока не видели" text={`Ник «${name}» не появлялся на серверах за последние 90 дней.`}><a href="/community" className="btn mt-2">К сообществу</a></Empty>;
  if (error) return <ErrorLine text={error} />;
  if (!p) return <div className="space-y-4" aria-busy="true"><div className="tile skeleton h-44" /><div className="tile skeleton h-60" /></div>;

  const rank = p.rankId ? rankById(p.rankId) : null;
  const maxH = Math.max(1, ...p.byHour);
  const maxS = Math.max(1, ...p.servers.map((s) => s.hours));
  return (
    <div className="space-y-5">
      <Crumbs items={[['/community', 'Сообщество'], [`/player/${encodeURIComponent(p.name)}`, p.name]]} />
      <section className="tile pl-hero fade-in">
        <span className="pl-ava" aria-hidden><NickPic name={p.name} size={72} className="pl-ava-img">{p.name.slice(0, 1).toUpperCase()}</NickPic></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-black leading-tight">{p.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 font-bold text-mute">
            {p.online ? (
              <span className="cm-live">
                сейчас в игре{(() => { const v = p.recent.find((r) => r.to == null); return v ? <> · <a href={`/servers/${v.serverId}`} className="underline decoration-dotted underline-offset-2">{v.serverName}</a></> : null; })()}
              </span>
            ) : p.lastSeen ? <span>был {ago(p.lastSeen)}</span> : null}
            {rank && <span className="pl-rank">{rank.name}</span>}
            <span>впервые {fmtDateTime(p.firstSeen)}</span>
          </p>
          <div className="mt-2"><FollowButton nick={p.name} /></div>
        </div>
        {(p.ranks.week != null || p.ranks.month != null || p.ranks.all != null) && (
          <div className="pl-places basis-full" aria-label="Места среди игроков">
            <RankChip place={p.ranks.week} before={p.ranks.weekBefore} label="за неделю" />
            <RankChip place={p.ranks.month} label="за месяц" />
            <RankChip place={p.ranks.all} label="за всё время" />
          </div>
        )}
        <dl className="pl-stats">
          <div><dt>Часов</dt><dd>{num(p.hours)}</dd></div>
          <div><dt>Визитов</dt><dd>{p.visits}</dd></div>
          <div><dt>Дней в игре</dt><dd>{p.days}</dd></div>
          <div className={p.streak >= 3 ? 'is-hot' : ''}><dt>Подряд</dt><dd>{p.streak >= 3 ? '🔥 ' : ''}{p.streak} {plural(p.streak, ['день', 'дня', 'дней'])}</dd></div>
        </dl>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="tile p-4 sm:p-5">
          <h2 className="mb-1 text-lg font-extrabold">Когда играет</h2>
          <p className="mb-3 text-sm font-semibold text-mute">{p.usualHour != null ? `Чаще всего ${partOfDay(p.usualHour)}, около ${String(p.usualHour).padStart(2, '0')}:00` : 'Пока мало данных'}</p>
          <div className="pl-hours" role="img" aria-label="Часы в игре по времени суток">
            {p.byHour.map((v, h) => (
              <span key={h} className="pl-hour" title={`${String(h).padStart(2, '0')}:00 — ${num(v)} ч`}>
                <i style={{ height: `${(v / maxH) * 100}%` }} />
                <b>{h % 3 === 0 ? h : ''}</b>
              </span>
            ))}
          </div>
        </section>

        <section className="tile p-4 sm:p-5">
          <h2 className="mb-3 text-lg font-extrabold">Где играет</h2>
          <ul className="grid gap-2.5">
            {p.servers.map((s) => (
              <li key={s.id}>
                <a href={`/servers/${s.id}`} className="cm-srv">
                  <GameAvatar game={s.game} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-extrabold">{s.name}</span>
                    <span className="cm-srv-bar"><span style={{ width: `${(s.hours / maxS) * 100}%` }} /></span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-extrabold tabular-nums">{num(s.hours)} ч</span>
                    <span className="block text-xs font-bold text-mute">{s.visits} {plural(s.visits, ['визит', 'визита', 'визитов'])}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="tile p-4 sm:p-5">
        <h2 className="mb-3 text-lg font-extrabold">Активность за 90 дней</h2>
        <ActivityStrip byDay={p.byDay} />
      </section>

      {p.achievements && p.achievements.length > 0 && (
        <section className="tile p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-extrabold">Достижения</h2>
            <span className="text-sm font-bold text-mute">{p.achievements.filter((a) => a.earned).length} из {p.achievements.length}</span>
          </div>
          <ul className="pf-ach-grid">
            {[...p.achievements].sort((x, y) => Number(y.earned) - Number(x.earned) || (y.earnedAt ?? 0) - (x.earnedAt ?? 0)).map((a) => <AchievementCard key={a.id} a={a} />)}
          </ul>
        </section>
      )}

      <section className="tile p-4 sm:p-5">
        <h2 className="mb-3 text-lg font-extrabold">Последние визиты</h2>
        <ul className="divide-y divide-line">
          {p.recent.map((v) => (
            <li key={`${v.serverId}-${v.from}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <a href={`/servers/${v.serverId}`} className="min-w-0 flex-1 truncate font-bold hover:text-link">{v.serverName}</a>
              <span className="text-sm font-semibold text-mute">
                {fmtDateTime(v.from)} – {v.to ? fmtTime(v.to) : 'сейчас'}
                {v.to ? ` · ${Math.max(1, Math.round((v.to - v.from) / 60_000))} мин` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
