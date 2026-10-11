import { useEffect, useState } from 'react';
import { api, type Server, type ServerInput } from '../api';
import { useAuth } from '../auth';
import { gameColor, gameLabel } from '../games';
import { ServersArt } from '../components/Illustrations';
import { Empty, ErrorLine, FillBar, FleetBar, GameAvatar, IconServers, PageHead, Spark, StatusPill, ago, plural, toast, usePoll } from '../ui';
import ServerDetail from './ServerDetail';
import ServerForm, { emptyServer } from './ServerForm';

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
  const [editing, setEditing] = useState<{ id?: number; data: ServerInput } | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    api<Server[]>('/servers')
      .then((s) => { setServers(s); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  usePoll(load, 10_000);

  const sorted = [...servers].sort((a, b) => Number(favs.includes(b.id)) - Number(favs.includes(a.id)));
  const online = servers.filter((s) => s.online);
  const players = online.reduce((n, s) => n + s.players, 0);
  const pings = online.filter((s) => s.ping != null).map((s) => s.ping as number);
  const avg = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;

  const remove = async (s: Server) => {
    if (!window.confirm(`Удалить сервер «${s.name}» вместе с привязками к Discord?`)) return;
    await api(`/servers/${s.id}`, 'DELETE').then(() => toast('Сервер удалён')).catch((e) => setError(e.message));
    load();
  };

  const add = () => setEditing({ data: emptyServer });
  const open = (s: Server) => { window.location.hash = `#/servers/${s.id}`; };

  return (
    <div className="space-y-6">
      <PageHead title="Серверы" subtitle="Состояние ваших игровых серверов в реальном времени" icon={<IconServers />}>
        {isAdmin && <button className="btn" onClick={add}>+ Добавить сервер</button>}
      </PageHead>
      <ErrorLine text={error} />

      {servers.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            [plural(servers.length, ['Сервер', 'Сервера', 'Серверов']), servers.length],
            ['Онлайн', `${online.length} из ${servers.length}`],
            [plural(players, ['Игрок', 'Игрока', 'Игроков']), players],
            ['Средний пинг', avg == null ? '–' : `${avg} мс`],
          ].map(([k, v]) => (
            <div key={k} className="panel px-5 py-4">
              <div className="text-sm font-extrabold text-mute">{k}</div>
              <div className="text-3xl font-black tabular-nums text-link">{v}</div>
            </div>
          ))}
        </div>
      )}

      {servers.length > 0 && (
        <FleetBar
          online={servers.filter((x) => x.online && !(x.ping != null && x.ping > 100)).length}
          lag={servers.filter((x) => x.online && x.ping != null && x.ping > 100).length}
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
          {isAdmin && <button className="btn mt-3" onClick={add}>+ Добавить сервер</button>}
        </Empty>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((s) => {
          const color = gameColor(s.game);
          const lag = s.ping != null && s.ping > 100;
          return (
            <article
              key={s.id}
              className="pop panel flex cursor-pointer flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:ring-2 hover:ring-brand/30"
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
                      className={`text-xl leading-none transition hover:scale-110 ${favs.includes(s.id) ? 'text-warn' : 'text-mute'}`}
                      title={favs.includes(s.id) ? 'Убрать из избранного' : 'В избранное'}
                      aria-pressed={favs.includes(s.id)}
                    >{favs.includes(s.id) ? '★' : '☆'}</button>
                  )}
                </div>
              </div>

              {s.online ? (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-black tabular-nums">{s.players}</span>
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
                {isAdmin && <button className="btn btn-soft btn-sm" onClick={() => setEditing({ id: s.id, data: { name: s.customName, game: s.game, host: s.host, port: s.port, queryPort: s.queryPort, displayAddress: s.displayAddress } })}>Изменить</button>}
                {isAdmin && <button className="btn btn-danger btn-sm" onClick={() => remove(s)}>Удалить</button>}
              </div>
            </article>
          );
        })}
      </div>

      {editing && <ServerForm initial={editing.data} id={editing.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast('Сервер сохранён'); load(); }} />}
    </div>
  );
}
