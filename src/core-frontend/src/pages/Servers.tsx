import { useEffect, useState, type ReactNode } from 'react';
import { api, type Server } from '../api';
import { useAuth } from '../auth';
import { gameColor, gameLabel } from '../games';
import { ServersArt } from '../components/Illustrations';
import { AnimatedNumber, Empty, ErrorLine, FillBar, FleetBar, GameAvatar, IconServers, PageHead, Spark, StatusPill, ago, isLag, plural, usePoll } from '../ui';
import ServerDetail from './ServerDetail';

export default function ServersPage({ sub }: { sub: string }) {
  const id = Number(sub);
  if (sub && Number.isInteger(id) && id > 0) return <ServerDetail id={id} />;
  return <ServerList />;
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

  const load = () =>
    api<Server[]>('/servers')
      .then((s) => { setServers(s); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  usePoll(load, 10_000);

  const sorted = [...servers].sort((a, b) => Number(favs.includes(b.id)) - Number(favs.includes(a.id)) || Number(b.online) - Number(a.online));
  const online = servers.filter((s) => s.online);
  const players = online.reduce((n, s) => n + s.players, 0);
  const pings = online.filter((s) => s.ping != null).map((s) => s.ping as number);
  const avg = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;

  const open = (s: Server) => { window.location.hash = `#/servers/${s.id}`; };

  return (
    <div className="space-y-6">
      <PageHead title="Серверы" subtitle="Состояние ваших игровых серверов в реальном времени" icon={<IconServers />}>
        {isAdmin && <a className="btn btn-soft" href="#/admin/servers">Управление серверами</a>}
      </PageHead>
      <ErrorLine text={error} />

      {servers.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {([
            [plural(servers.length, ['Сервер', 'Сервера', 'Серверов']), <AnimatedNumber value={servers.length} />],
            ['Онлайн', <><AnimatedNumber value={online.length} /> из {servers.length}</>],
            [plural(players, ['Игрок', 'Игрока', 'Игроков']), <AnimatedNumber value={players} pulse />],
            ['Средний пинг', avg == null ? '–' : <><AnimatedNumber value={avg} /> мс</>],
          ] as [string, ReactNode][]).map(([k, v]) => (
            <div key={k} className="panel px-5 py-4">
              <div className="text-sm font-extrabold text-mute">{k}</div>
              <div className="text-2xl font-black tabular-nums text-link sm:text-3xl">{v}</div>
            </div>
          ))}
        </div>
      )}

      {servers.length > 0 && (
        <FleetBar
          online={servers.filter((x) => x.online && !isLag(x)).length}
          lag={servers.filter(isLag).length}
          offline={servers.filter((x) => x.hasStatus && !x.online).length}
        />
      )}

      {!loaded && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton panel h-56" />)}
        </div>
      )}

      {loaded && servers.length === 0 && (
        <Empty art={<ServersArt />} title={isAdmin ? 'Добавьте первый сервер' : 'Серверов пока нет'} text={isAdmin ? 'Укажите игру и адрес, и панель начнёт показывать онлайн, карту и пинг. Потом привяжите Discord-канал.' : 'Администратор ещё не добавил ни одного сервера. Загляните позже.'}>
          {isAdmin && <a className="btn mt-3" href="#/admin/servers">Добавить в админке</a>}
        </Empty>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((s, i) => {
          const color = gameColor(s.game);
          const lag = isLag(s);
          return (
            <article
              key={s.id}
              className={`pop panel flex cursor-pointer flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:ring-2 hover:ring-brand/30 ${i === 0 && sorted.length > 2 ? 'lg:col-span-2' : ''}`}
              onClick={() => open(s)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <GameAvatar game={s.game} />
                  <div className="min-w-0">
                    <h3 className="line-clamp-3 break-words font-black leading-tight" title={s.name}>
                      <a href={`#/servers/${s.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-link">{s.name}</a>
                    </h3>
                    <div className="truncate text-sm font-bold text-mute">{gameLabel(s.game)}</div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <StatusPill online={s.online} known={s.hasStatus} lag={lag} />
                  {me && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void toggleFav(s.id); }}
                      className={`grid h-9 w-9 place-items-center rounded-full text-xl leading-none transition hover:scale-110 max-sm:h-11 max-sm:w-11 ${favs.includes(s.id) ? 'text-warn' : 'text-mute'}`}
                      title={favs.includes(s.id) ? 'Убрать из избранного' : 'В избранное'}
                      aria-label={`В избранное: ${s.name}`}
                      aria-pressed={favs.includes(s.id)}
                    >{favs.includes(s.id) ? '★' : '☆'}</button>
                  )}
                </div>
              </div>

              {s.online ? (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <AnimatedNumber value={s.players} pulse className="text-4xl font-black" />
                    <span className="font-extrabold text-mute">/ {s.maxPlayers}</span>
                    <span className="ml-auto text-sm font-bold text-mute">{s.ping != null ? `${s.ping} мс` : ''}</span>
                  </div>
                  <FillBar value={s.players} max={s.maxPlayers} color={color} />
                  <Spark serverId={s.id} color={color} />
                </>
              ) : (
                s.hasStatus && (
                  <div className="rounded-2xl bg-badbg px-3.5 py-2.5" title={s.error ?? undefined}>
                    <p className="line-clamp-2 text-sm font-bold leading-snug text-bad">{s.error ?? 'Сервер не отвечает'}</p>
                  </div>
                )
              )}

              <div className="flex items-center justify-between gap-2 text-sm font-bold text-mute">
                <span className="truncate font-mono text-sm" title={s.address}>{s.address}</span>
                <span className="shrink-0">{s.online && s.map ? s.map : ago(s.updatedAt)}</span>
              </div>

              <div className="mt-auto flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                <a className="btn btn-soft btn-sm" href={`#/servers/${s.id}`}>Подробнее</a>
              </div>
            </article>
          );
        })}
      </div>

    </div>
  );
}
