import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Server, type StatusInfo } from '../api';
import { useAuth } from '../auth';
import { gameColor, gameGradient, gameLabel } from '../games';
import { ServersArt } from '../components/Illustrations';
import { AnimatedNumber, Empty, ErrorLine, GameAvatar, IconServers, LAG_PING, PageHead, Spark, StatusPill, ago, isLag, plural, usePoll } from '../ui';
import ServerDetail from './ServerDetail';

export default function ServersPage({ sub }: { sub: string }) {
  const id = Number(sub);
  if (sub && Number.isInteger(id) && id > 0) return <ServerDetail id={id} />;
  return <ServerList />;
}

function FavButton({ on, name, onClick, className = '' }: { on: boolean; name: string; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`grid h-9 w-9 place-items-center rounded-full text-xl leading-none transition hover:scale-110 max-sm:h-11 max-sm:w-11 ${className}`}
      title={on ? 'Убрать из избранного' : 'В избранное'}
      aria-label={`В избранное: ${name}`}
      aria-pressed={on}
    >
      {on ? '★' : '☆'}
    </button>
  );
}

function ServerList() {
  const { me, isAdmin } = useAuth();
  const [favs, setFavs] = useState<number[]>([]);
  useEffect(() => {
    if (me) api<number[]>('/favorites').then(setFavs).catch(() => undefined);
    else setFavs([]);
  }, [me]);
  const toggleFav = async (id: number) => {
    const on = favs.includes(id);
    setFavs(on ? favs.filter((x) => x !== id) : [...favs, id]);
    await api(`/favorites/${id}`, on ? 'DELETE' : 'PUT').catch(() => undefined);
  };
  const [servers, setServers] = useState<Server[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [uptime, setUptime] = useState<Map<number, number>>(new Map());

  const load = () =>
    api<Server[]>('/servers')
      .then((s) => { setServers(s); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  usePoll(load, 10_000);
  // 30-day availability comes from the public status endpoint; the tile is simply hidden when it has no data
  usePoll(
    () => api<StatusInfo>('/status')
      .then((r) => setUptime(new Map(r.servers.filter((x) => x.uptime30 != null).map((x) => [x.id, x.uptime30 as number]))))
      .catch(() => undefined),
    5 * 60_000,
  );

  const sorted = useMemo(
    () => [...servers].sort((a, b) => Number(favs.includes(b.id)) - Number(favs.includes(a.id)) || Number(b.online) - Number(a.online)),
    [servers, favs],
  );
  const online = servers.filter((s) => s.online);
  const players = online.reduce((n, s) => n + s.players, 0);
  const slots = online.reduce((n, s) => n + s.maxPlayers, 0);
  const pings = online.filter((s) => s.ping != null).map((s) => s.ping as number);
  const avg = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;
  const upVals = servers.map((s) => uptime.get(s.id)).filter((v): v is number => v != null);
  const upAvg = upVals.length ? upVals.reduce((a, b) => a + b, 0) / upVals.length : null;
  const upLow = upVals.filter((v) => v < 99).length;

  // the hero: the first favourite (online ones first), otherwise the busiest online server
  const hero = useMemo(() => {
    if (sorted.length === 0) return null;
    const fav = sorted.find((s) => favs.includes(s.id));
    if (fav) return fav;
    const busiest = [...online].sort((a, b) => b.players - a.players)[0];
    return busiest ?? sorted[0];
  }, [sorted, favs, online]);
  const rest = sorted.filter((s) => s.id !== hero?.id);

  const open = (s: Server) => { window.location.hash = `#/servers/${s.id}`; };

  const stats: { k: string; v: ReactNode; s: string; i: string }[] = [
    { i: 'M3 6h18M3 12h18M3 18h18', k: plural(servers.length, ['Сервер', 'Сервера', 'Серверов']), v: <AnimatedNumber value={servers.length} />, s: `${online.length} онлайн` },
    { i: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8', k: 'Игроков сейчас', v: <AnimatedNumber value={players} pulse />, s: slots > 0 ? `из ${slots} мест` : 'нет серверов онлайн' },
    {
      i: 'M22 12h-4l-3 9L9 3l-3 9H2',
      k: 'Средний пинг',
      v: avg == null ? '–' : <><AnimatedNumber value={avg} /><small> мс</small></>,
      s: avg == null ? 'нет данных' : avg > LAG_PING ? 'высокий' : 'в норме',
    },
  ];
  if (upAvg != null) {
    stats.push({
      i: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
      k: 'Аптайм 30 дн',
      v: <>{(Math.round(upAvg * 10) / 10).toLocaleString('ru-RU')}<small>%</small></>,
      s: upLow === 0 ? 'без сбоев' : `${upLow} ${plural(upLow, ['сервер', 'сервера', 'серверов'])} ниже 99%`,
    });
  }

  return (
    <div className="space-y-5">
      <PageHead title="Серверы" subtitle="Состояние ваших игровых серверов в реальном времени" icon={<IconServers />}>
        {isAdmin && <a className="btn btn-soft" href="#/admin/servers">Управление серверами</a>}
      </PageHead>
      <ErrorLine text={error} />

      {!loaded && (
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-12" aria-busy="true" aria-label="Загрузка">
          <div className="skeleton tile col-span-2 h-72 lg:col-span-6 lg:row-span-2 lg:h-auto" />
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton tile h-32 lg:col-span-3" />)}
          {[0, 1, 2].map((i) => <div key={i} className="skeleton tile col-span-2 h-60 sm:col-span-1 lg:col-span-3" />)}
        </div>
      )}

      {loaded && servers.length === 0 && (
        <Empty art={<ServersArt />} title={isAdmin ? 'Добавьте первый сервер' : 'Серверов пока нет'} text={isAdmin ? 'Укажите игру и адрес, и панель начнёт показывать онлайн, карту и пинг. Потом привяжите Discord-канал.' : 'Администратор ещё не добавил ни одного сервера. Загляните позже.'}>
          {isAdmin && <a className="btn mt-3" href="#/admin/servers">Добавить в админке</a>}
        </Empty>
      )}

      {servers.length > 0 && (
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-12">
          {hero && <HeroTile s={hero} uptime={uptime.get(hero.id)} fav={me ? favs.includes(hero.id) : null} onFav={() => void toggleFav(hero.id)} onOpen={() => open(hero)} />}

          {stats.map((t, i) => (
            <div
              key={t.k}
              className={`tile flex flex-col gap-1 p-4 sm:p-[18px] ${stats.length === 3 && i === 2 ? 'col-span-2 lg:col-span-6' : 'col-span-1 lg:col-span-3'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="stat-k">{t.k}</div>
                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-soft text-link">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={t.i} /></svg>
                </span>
              </div>
              <div className="mt-auto">
                <div className="stat-v">{t.v}</div>
                <div className="stat-s mt-0.5">{t.s}</div>
              </div>
            </div>
          ))}

          {rest.map((s) => (
            <SmallTile key={s.id} s={s} fav={me ? favs.includes(s.id) : null} onFav={() => void toggleFav(s.id)} onOpen={() => open(s)} />
          ))}
        </div>
      )}
    </div>
  );
}

function HeroTile({ s, uptime, fav, onFav, onOpen }: { s: Server; uptime?: number; fav: boolean | null; onFav: () => void; onOpen: () => void }) {
  const [c1, c2] = gameGradient(s.game);
  const lag = isLag(s);
  return (
    <article
      className="tile-hover relative col-span-2 flex cursor-pointer flex-col gap-3 overflow-hidden rounded-[26px] p-5 text-white shadow-soft lg:col-span-6 lg:row-span-2 lg:p-6"
      style={{ background: `linear-gradient(140deg, ${c1}, ${c2})`, boxShadow: `0 1px 2px rgba(20,24,40,.06), 0 18px 40px -12px ${c1}88` }}
      onClick={onOpen}
    >
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/15" />
      <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 h-52 w-52 rounded-full bg-black/10" />

      <div className="relative flex items-start gap-3">
        <GameAvatar game={s.game} size={48} glass />
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 break-words text-lg font-extrabold leading-tight sm:text-xl" title={s.name}>
            <a href={`#/servers/${s.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{s.name}</a>
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] font-bold text-white/90">
            <span>{gameLabel(s.game)}</span>
            <span aria-hidden>·</span>
            <code className="truncate font-mono text-xs font-semibold" title={s.address}>{s.address}</code>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <StatusPill online={s.online} known={s.hasStatus} lag={lag} />
          {fav != null && <FavButton on={fav} name={s.name} onClick={onFav} className={fav ? 'text-white' : 'text-white/80'} />}
        </div>
      </div>

      {s.online ? (
        <>
          <div className="relative flex flex-wrap items-baseline gap-x-2.5 gap-y-1 pt-1">
            <AnimatedNumber value={s.players} pulse className="text-[64px] font-extrabold leading-none tracking-[-0.045em] sm:text-[78px]" />
            <span className="text-lg font-bold text-white/90">/ {s.maxPlayers} {plural(s.maxPlayers, ['игрок', 'игрока', 'игроков'])}</span>
            {s.ping != null && <span className="ml-auto font-bold text-white/90">пинг {s.ping} мс</span>}
          </div>
          <div className="relative mt-auto pt-2">
            <Spark serverId={s.id} color="#ffffff" variant="hero" />
          </div>
        </>
      ) : (
        s.hasStatus && (
          <div className="relative mt-4 rounded-2xl bg-white/20 px-4 py-3" title={s.error ?? undefined}>
            <p className="line-clamp-3 text-base font-extrabold leading-snug">{s.error ?? 'Сервер не отвечает'}</p>
            <p className="mt-1 text-sm font-semibold text-white/85">Последний ответ: {ago(s.updatedAt)}</p>
          </div>
        )
      )}

      <div className="relative mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px] font-bold text-white/90">
        <span>за 24 часа</span>
        {uptime != null && <span>аптайм {(Math.round(uptime * 10) / 10).toLocaleString('ru-RU')}%</span>}
        <span className="truncate">{s.online && s.map ? `карта ${s.map}` : `обновлено ${ago(s.updatedAt)}`}</span>
      </div>
    </article>
  );
}

function SmallTile({ s, fav, onFav, onOpen }: { s: Server; fav: boolean | null; onFav: () => void; onOpen: () => void }) {
  const [c1, c2] = gameGradient(s.game);
  const lag = isLag(s);
  return (
    <article className="tile tile-hover pop col-span-2 flex cursor-pointer flex-col gap-1.5 p-2.5 pb-3.5 sm:col-span-1 lg:col-span-3" onClick={onOpen}>
      <div className="flex h-[88px] items-start justify-between rounded-[18px] p-2.5" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
        <GameAvatar game={s.game} size={40} glass />
        <div className="flex items-center gap-0.5">
          <StatusPill online={s.online} known={s.hasStatus} lag={lag} />
          {fav != null && <FavButton on={fav} name={s.name} onClick={onFav} className={`-mr-1 -mt-0.5 ${fav ? 'text-white' : 'text-white/85'}`} />}
        </div>
      </div>

      <div className="px-1.5">
        <h3 className="line-clamp-2 break-words text-[14.5px] font-extrabold leading-tight" title={s.name}>
          <a href={`#/servers/${s.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-link">{s.name}</a>
        </h3>
        <div className="mt-0.5 truncate text-[13px] font-bold text-mute">{gameLabel(s.game)}</div>
      </div>

      {s.online ? (
        <>
          <div className="flex items-baseline gap-1.5 px-1.5">
            <AnimatedNumber value={s.players} pulse className="text-[30px] font-extrabold leading-none tracking-[-0.03em]" />
            <span className="font-bold text-mute">/ {s.maxPlayers}</span>
            <span className="ml-auto text-[13px] font-bold text-mute">{s.ping != null ? `${s.ping} мс` : ''}</span>
          </div>
          <div className="px-1.5"><Spark serverId={s.id} color={gameColor(s.game)} /></div>
        </>
      ) : (
        s.hasStatus ? (
          <div className="mx-1.5 rounded-xl bg-badbg px-3 py-2.5" title={s.error ?? undefined}>
            <p className="line-clamp-2 text-[13px] font-bold leading-snug text-bad">{s.error ?? 'Сервер не отвечает'}</p>
          </div>
        ) : (
          <div className="mx-1.5 rounded-xl bg-soft px-3 py-2.5 text-[13px] font-bold text-mute">Ожидаем первый ответ</div>
        )
      )}

      <div className="mt-auto flex items-center justify-between gap-2 px-1.5 pt-1 text-xs font-bold text-mute">
        <span className="truncate font-mono" title={s.address}>{s.address}</span>
        <span className="shrink-0">{s.online && s.map ? s.map : ago(s.updatedAt)}</span>
      </div>
    </article>
  );
}
