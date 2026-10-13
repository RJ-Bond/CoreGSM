import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { api, type Server, type StatusInfo } from '../api';
import { useAuth } from '../auth';
import { gameColor, gameGradient, gameLabel } from '../games';
import { coverBackground } from '../cover';
import { AnimatedNumber, Burst, ErrorLine, GameAvatar, LoadError, IconServers, LAG_PING, PageHead, Spark, StatusPill, ago, isLag, plural, useDepth, usePoll } from '../ui';
import { CapacityBar, CountReact, ListSkeleton, NoFavsState, NoMatchState, NoServersState, StatusFlash, TilesSkeleton, reactionOf, useServerReactions, type Reactions } from '../components/servers/serverUi';
import { ServersList, ServersTv, readView, saveView, type ServersView } from '../components/servers/ServerViews';
import NotFound from '../components/NotFound';
import ServerDetail, { SERVER_TABS } from './ServerDetail';

export default function ServersPage({ sub }: { sub: string }) {
  // "12/players" -> server 12, tab "players"
  const [idPart = '', tabPart = ''] = sub.split('/');
  const id = Number(idPart);
  const tab = (SERVER_TABS as readonly string[]).includes(tabPart) ? tabPart : '';
  if (idPart && /^\d+$/.test(idPart) && Number.isInteger(id) && id > 0 && (!tabPart || tab)) return <ServerDetail id={id} tab={tab} />;
  // "#/servers/abc" or an unknown tab: not a server page
  if (sub) return <NotFound kind="server" />;
  return <ServerList />;
}

/** a greeting for the signed-in user: «Доброе утро, Иван» */
function greeting(name: string): string {
  const h = new Date().getHours();
  const hello = h >= 5 && h < 12 ? 'Доброе утро' : h >= 12 && h < 18 ? 'Добрый день' : h >= 18 && h < 23 ? 'Добрый вечер' : 'Доброй ночи';
  return `${hello}, ${name.trim() || name}`;
}

function FavButton({ on, name, onClick, className = '' }: { on: boolean; name: string; onClick: () => void; className?: string }) {
  // the star pops (scale, tilt and a few sparks) only after the user's own click, not when the list loads
  const [pops, setPops] = useState(0);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!on) setPops((n) => n + 1); onClick(); }}
      className={`grid h-9 w-9 place-items-center rounded-full text-xl leading-none transition hover:scale-110 max-sm:h-11 max-sm:w-11 ${className}`}
      title={on ? 'Убрать из избранного' : 'В избранное'}
      aria-label={`В избранное: ${name}`}
      aria-pressed={on}
    >
      <span className="star-wrap">
        <span key={on ? pops : 'off'} className={on && pops > 0 ? 'star-pop' : ''} aria-hidden>{on ? '★' : '☆'}</span>
        {on && pops > 0 && <Burst key={pops} count={6} radius={15} />}
      </span>
    </button>
  );
}

type Filter = 'all' | 'online' | 'offline' | 'fav';
const FILTER_KEY = 'coregsm_server_filter';

/** staggered entrance: the tile number goes to the --i custom property */
const stagger = (i: number): CSSProperties => ({ ['--i' as string]: i });

/** a small "live" indicator: pulsing dot and how fresh the data is */
function LiveBadge({ at }: { at: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 5000);
    return () => window.clearInterval(t);
  }, []);
  if (!at) return null;
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-soft px-3 py-1 text-xs font-extrabold text-mute" title="Страница обновляется сама">
      <span className="live-dot" aria-hidden />
      обновлено {ago(at)}
    </span>
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
  const [updatedAt, setUpdatedAt] = useState(0);
  const [filter, setFilterState] = useState<Filter>(() => {
    try {
      // deep link: #/servers?filter=online
      const q = window.location.hash.match(/[?&]filter=(\w+)/)?.[1];
      const v = q ?? localStorage.getItem(FILTER_KEY);
      return v === 'online' || v === 'offline' || v === 'fav' ? v : 'all';
    } catch {
      return 'all';
    }
  });
  const setFilter = (f: Filter) => {
    setFilterState(f);
    try {
      localStorage.setItem(FILTER_KEY, f);
    } catch {
      /* not remembered */
    }
  };

  const [view, setViewState] = useState<ServersView>(readView);
  const setView = (v: ServersView) => { setViewState(v); saveView(v); };

  const load = () =>
    api<Server[]>('/servers')
      .then((s) => { setServers(s); setError(''); setUpdatedAt(Date.now()); })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  // the TV mode refreshes twice as often
  usePoll(load, view === 'tv' ? 5_000 : 10_000);
  const rx = useServerReactions(servers, loaded);
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
  const offlineCount = servers.filter((s) => !s.online).length;
  const favCount = servers.filter((s) => favs.includes(s.id)).length;
  // a filter other than "all" turns the bento into a plain grid of the matching servers
  const effFilter: Filter = filter === 'fav' && !me ? 'all' : filter;
  const filtered = effFilter === 'all' ? [] : sorted.filter((s) => (effFilter === 'online' ? s.online : effFilter === 'offline' ? !s.online : favs.includes(s.id)));

  const effView: ServersView = servers.length === 0 ? 'tiles' : view;
  const visible = effFilter === 'all' ? sorted : filtered;
  const resetFilter = () => setFilter('all');

  const open = (s: Server) => { window.location.hash = `#/servers/${s.id}`; };

  const stats: { k: string; v: ReactNode; s: string; i: string; r?: number }[] = [
    { i: 'M3 6h18M3 12h18M3 18h18', k: plural(servers.length, ['Сервер', 'Сервера', 'Серверов']), v: <AnimatedNumber value={servers.length} />, s: `${online.length} онлайн`, r: servers.length ? online.length / servers.length : 0 },
    { i: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8', k: 'Игроков сейчас', v: <AnimatedNumber value={players} pulse />, s: slots > 0 ? `из ${slots} мест` : 'нет серверов онлайн', r: slots > 0 ? players / slots : 0 },
    {
      i: 'M22 12h-4l-3 9L9 3l-3 9H2',
      k: 'Средний пинг',
      v: avg == null ? '–' : <><AnimatedNumber value={avg} /><small> мс</small></>,
      s: avg == null ? 'нет данных' : avg > LAG_PING ? 'высокий' : 'в норме',
      r: avg == null ? 0 : Math.min(1, avg / 200),
    },
  ];
  if (upAvg != null) {
    stats.push({
      i: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
      k: 'Аптайм 30 дн',
      v: <>{(Math.round(upAvg * 10) / 10).toLocaleString('ru-RU')}<small>%</small></>,
      s: upLow === 0 ? 'без сбоев' : `${upLow} ${plural(upLow, ['сервер', 'сервера', 'серверов'])} ниже 99%`,
      r: upAvg / 100,
    });
  }

  return (
    <div className="space-y-5">
      <PageHead
        title="Серверы"
        subtitle={me ? `${greeting(me.username)}. Серверы в реальном времени` : 'Состояние ваших игровых серверов в реальном времени'}
        icon={<IconServers />}
      >
        <LiveBadge at={updatedAt} />
        {isAdmin && <a className="btn btn-soft" href="#/admin/servers" data-magnetic>Управление серверами</a>}
      </PageHead>

      {servers.length > 0 && (
        <div className="srv-bar">
          {servers.length > 1 ? (
            <nav className="seg flex w-fit max-w-full overflow-x-auto" aria-label="Фильтр серверов">
              {([
                ['all', `Все · ${servers.length}`],
                ['online', `Онлайн · ${online.length}`],
                ['offline', `Недоступные · ${offlineCount}`],
                ...(me ? [['fav', `Избранные · ${favCount}`]] : []),
              ] as [Filter, string][]).map(([id, label]) => (
                <button key={id} type="button" className="seg-item whitespace-nowrap" aria-pressed={effFilter === id} onClick={() => setFilter(id)}>{label}</button>
              ))}
            </nav>
          ) : <span />}
          <div className="seg" role="group" aria-label="Вид списка">
            {([['tiles', 'Плитки'], ['list', 'Список'], ['tv', 'ТВ']] as [ServersView, string][]).map(([id, label]) => (
              <button key={id} type="button" className="seg-item" aria-pressed={effView === id} onClick={() => setView(id)} title={id === 'tv' ? 'Экран для большого телевизора' : undefined}>{label}</button>
            ))}
          </div>
        </div>
      )}
      {error && servers.length === 0 ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}

      {!loaded && (effView === 'list' ? <ListSkeleton /> : <TilesSkeleton />)}

      {loaded && !error && servers.length === 0 && <NoServersState isAdmin={isAdmin} />}

      {servers.length > 0 && visible.length === 0 && (
        effFilter === 'fav' && favCount === 0
          ? <NoFavsState onReset={resetFilter} />
          : <NoMatchState what={effFilter === 'offline' ? 'offline' : 'online'} onReset={resetFilter} />
      )}

      {servers.length > 0 && visible.length > 0 && effView === 'list' && (
        <ServersList
          servers={visible}
          uptime={uptime}
          rx={rx}
          favOf={(id) => (me ? favs.includes(id) : null)}
          onOpen={open}
          renderFav={(sv, on) => <FavButton on={on} name={sv.name} onClick={() => void toggleFav(sv.id)} className={on ? 'text-warn' : 'text-mute'} />}
        />
      )}

      {servers.length > 0 && visible.length > 0 && effView === 'tv' && (
        <ServersTv servers={visible} uptime={uptime} rx={rx} updatedAt={updatedAt} onExit={() => setView('tiles')} />
      )}

      {servers.length > 0 && effView === 'tiles' && effFilter !== 'all' && visible.length > 0 && (
        <div className="fade-in grid grid-cols-2 gap-3.5 lg:grid-cols-12">
          {filtered.map((s, i) => (
            <SmallTile key={s.id} rx={rx} s={s} idx={i} fav={me ? favs.includes(s.id) : null} onFav={() => void toggleFav(s.id)} onOpen={() => open(s)} />
          ))}
        </div>
      )}

      {servers.length > 0 && effView === 'tiles' && effFilter === 'all' && (
        <div className="fade-in grid grid-cols-2 gap-3.5 lg:grid-cols-12">
          {hero && <HeroTile key={hero.id} rx={rx} idx={0} s={hero} uptime={uptime.get(hero.id)} fav={me ? favs.includes(hero.id) : null} onFav={() => void toggleFav(hero.id)} onOpen={() => open(hero)} />}

          {stats.map((t, i) => (
            <div
              key={t.k}
              style={stagger(i + 1)}
              className={`tile tile-in flex flex-col gap-1 p-4 sm:p-[18px] ${stats.length === 3 && i === 2 ? 'col-span-2 lg:col-span-6' : 'col-span-1 lg:col-span-3'}`}
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
                {t.r != null && <div className="meter mt-2.5" aria-hidden><i style={{ width: `${Math.round(Math.max(0, Math.min(1, t.r)) * 100)}%` }} /></div>}
              </div>
            </div>
          ))}

          {rest.map((s, i) => (
            <SmallTile key={s.id} rx={rx} s={s} idx={i + 1 + stats.length} fav={me ? favs.includes(s.id) : null} onFav={() => void toggleFav(s.id)} onOpen={() => open(s)} />
          ))}
        </div>
      )}
    </div>
  );
}

function HeroTile({ s, idx, uptime, fav, onFav, onOpen, rx }: { rx: Reactions; s: Server; idx: number; uptime?: number; fav: boolean | null; onFav: () => void; onOpen: () => void }) {
  const [c1, c2] = gameGradient(s.game);
  const lag = isLag(s);
  const depth = useDepth<HTMLElement>();
  const r = reactionOf(rx, s.id);
  return (
    <article
      className="depth tile-in tile-hover relative col-span-2 flex cursor-pointer flex-col gap-3 overflow-hidden rounded-[26px] p-5 text-white shadow-soft lg:col-span-6 lg:row-span-2 lg:p-6"
      style={{ ...stagger(idx), background: coverBackground(s.coverUrl, `linear-gradient(140deg, ${c1}, ${c2})`, { strong: true, game: s.game }), boxShadow: `0 1px 2px rgba(20,24,40,.06), 0 18px 40px -12px ${c1}88` }}
      onClick={onOpen}
      {...depth}
    >
      <span aria-hidden className="depth-l1 pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/15" />
      <span aria-hidden className="depth-l2 pointer-events-none absolute -bottom-24 -left-10 h-52 w-52 rounded-full bg-black/10" />

      <div className="relative flex items-start gap-3">
        <GameAvatar game={s.game} size={48} glass vtId={s.id} />
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
          <StatusFlash r={r}><StatusPill glass online={s.online} known={s.hasStatus} lag={lag} /></StatusFlash>
          {fav != null && <FavButton on={fav} name={s.name} onClick={onFav} className={fav ? 'text-white' : 'text-white/80'} />}
        </div>
      </div>

      {s.online ? (
        <>
          <div className="relative flex flex-wrap items-baseline gap-x-2.5 gap-y-1 pt-1">
            <CountReact r={r} onDark><AnimatedNumber value={s.players} className="text-[64px] font-extrabold leading-none tracking-[-0.045em] sm:text-[78px]" /></CountReact>
            <span className="text-lg font-bold text-white/90">/ {s.maxPlayers} {plural(s.maxPlayers, ['игрок', 'игрока', 'игроков'])}</span>
            {s.ping != null && <span className="ml-auto font-bold text-white/90">пинг {s.ping} мс</span>}
          </div>
          <CapacityBar className="relative" players={s.players} max={s.maxPlayers} color="#fff" onDark />
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

function SmallTile({ s, idx, fav, onFav, onOpen, rx }: { rx: Reactions; s: Server; idx: number; fav: boolean | null; onFav: () => void; onOpen: () => void }) {
  const [c1, c2] = gameGradient(s.game);
  const lag = isLag(s);
  const r = reactionOf(rx, s.id);
  return (
    <article className="tile tile-in tile-hover relative col-span-2 flex cursor-pointer flex-col gap-1.5 p-2.5 pb-3.5 sm:col-span-1 lg:col-span-3" style={stagger(idx)} onClick={onOpen}>
      <div className={`flex h-[88px] items-start justify-between rounded-[18px] p-2.5 ${s.online ? '' : 'offline-cover'}`} style={{ background: coverBackground(s.coverUrl, `linear-gradient(135deg, ${c1}, ${c2})`, { small: true, game: s.game }), boxShadow: `inset 0 -3px 0 ${gameColor(s.game)}` }}>
        <GameAvatar game={s.game} size={40} glass vtId={s.id} />
        <div className="flex items-center gap-0.5">
          <StatusFlash r={r}><StatusPill glass online={s.online} known={s.hasStatus} lag={lag} /></StatusFlash>
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
            <CountReact r={r}><AnimatedNumber value={s.players} className="text-[30px] font-extrabold leading-none tracking-[-0.03em]" /></CountReact>
            <span className="font-bold text-mute">/ {s.maxPlayers}</span>
            <span className="ml-auto text-[13px] font-bold text-mute">{s.ping != null ? `${s.ping} мс` : ''}</span>
          </div>
          <CapacityBar className="px-1.5" players={s.players} max={s.maxPlayers} color={gameColor(s.game)} />
          <div className="px-1.5"><Spark serverId={s.id} color={gameColor(s.game)} /></div>
        </>
      ) : (
        s.hasStatus ? (
          <div className="mx-1.5 flex items-center gap-2 rounded-xl bg-badbg px-3 py-2" title={s.error ?? undefined}>
            <span className="h-2 w-2 shrink-0 rounded-full bg-bad" aria-hidden />
            <p className="truncate text-[13px] font-bold leading-snug text-bad">Не отвечает · {ago(s.updatedAt)}</p>
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
