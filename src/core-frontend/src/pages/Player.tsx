/**
 * The card of a player by the nick the game servers report (/player/<nick>): where they play, how much, at what
 * time of day, the streak of days in a row and the latest visits. Works without signing in on a public panel.
 */
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { rankById } from '../vrisingRanks';
import { Empty, ErrorLine, GameAvatar, ago, fmtDateTime, fmtTime, plural } from '../ui';
import '../styles/community.css';

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
  servers: { id: number; name: string; game: string; hours: number; visits: number; last: number }[];
  recent: { serverId: number; serverName: string; from: number; to: number | null }[];
  rankId?: string;
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
      <a href="/community" className="ml-1 inline-flex items-center gap-1 font-extrabold text-link hover:underline">← Сообщество</a>
      <section className="tile pl-hero fade-in">
        <span className="pl-ava" aria-hidden>{p.name.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-black leading-tight">{p.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 font-bold text-mute">
            {p.online ? <span className="cm-live">сейчас в игре</span> : p.lastSeen ? <span>был {ago(p.lastSeen)}</span> : null}
            {rank && <span className="pl-rank">{rank.name}</span>}
            <span>впервые {fmtDateTime(p.firstSeen)}</span>
          </p>
        </div>
        <dl className="pl-stats">
          <div><dt>Часов</dt><dd>{p.hours}</dd></div>
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
              <span key={h} className="pl-hour" title={`${String(h).padStart(2, '0')}:00 — ${v} ч`}>
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
                    <span className="block font-extrabold tabular-nums">{s.hours} ч</span>
                    <span className="block text-xs font-bold text-mute">{s.visits} {plural(s.visits, ['визит', 'визита', 'визитов'])}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

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
