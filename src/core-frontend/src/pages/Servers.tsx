import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { api, type Server, type StatusInfo } from '../api';
import { useAuth } from '../auth';
import { gameColor, gameGradient, gameLabel } from '../games';
import { coverBackground, emblemStyle, gameBackdrop } from '../cover';
import MaintenanceChip from '../components/MaintenanceChip';
import { AnimatedNumber, Burst, ErrorLine, GameAvatar, LoadError, IconServers, PageHead, Spark, StatusPill, ago, isLag, plural, spanCaption, useDepth, useSparkSpanMin, usePoll, navigate, routeQuery } from '../ui';
import { t, useI18n } from '../i18n';
import { CapacityBar, CountReact, ListSkeleton, NoFavsState, NoMatchState, NoServersState, StatusFlash, TilesSkeleton, reactionOf, useServerReactions, type Reactions } from '../components/servers/serverUi';
import { ServersList, readView, saveView, type SelectProps, type ServersView } from '../components/servers/ServerViews';
import CompareChart from '../components/servers/CompareChart';
import { AttentionStrip } from '../components/servers/AttentionStrip';
import { PulseStrip } from '../components/servers/PulseStrip';
import { WhatsNew, useWhatsNewOpen } from '../components/servers/WhatsNew';
import { BulkBar } from '../components/servers/BulkBar';
import { needsAttention, pickHero, type HeroReason, type OverviewData } from '../components/servers/overviewLogic';
import NotFound from '../components/NotFound';
import ServerDetail, { SERVER_TABS } from './ServerDetail';

export default function ServersPage({ sub }: { sub: string }) {
  // "12/players" -> server 12, tab "players"
  const [idPart = '', tabPart = ''] = sub.split('/');
  const id = Number(idPart);
  const tab = (SERVER_TABS as readonly string[]).includes(tabPart) ? tabPart : '';
  if (idPart && /^\d+$/.test(idPart) && Number.isInteger(id) && id > 0 && (!tabPart || tab)) return <ServerDetail id={id} tab={tab} />;
  // "/servers/abc" or an unknown tab: not a server page
  if (sub) return <NotFound kind="server" />;
  return <ServerList />;
}

/** a greeting for the signed-in user: «Доброе утро, Иван» */
function greeting(name: string): string {
  const h = new Date().getHours();
  const hello = h >= 5 && h < 12 ? 'Доброе утро' : h >= 12 && h < 18 ? 'Добрый день' : h >= 18 && h < 23 ? 'Добрый вечер' : 'Доброй ночи';
  return `${hello}, ${name.trim() || name}`;
}

/** `className` colours the star; `glass` is the variant for covers (white star on a translucent disc) */
function FavButton({ on, name, onClick, className = '', glass = false }: { on: boolean; name: string; onClick: () => void; className?: string; glass?: boolean }) {
  // the star pops (scale, tilt and a few sparks) only after the user's own click, not when the list loads
  const [pops, setPops] = useState(0);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!on) setPops((n) => n + 1); onClick(); }}
      className={glass ? 'btn-icon-glass btn-icon-sm' : 'btn-icon-ghost btn-icon-sm'}
      title={on ? 'Убрать из избранного' : 'В избранное'}
      aria-label={`В избранное: ${name}`}
      aria-pressed={on}
    >
      <span className={`star-wrap text-xl leading-none ${className}`}>
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
      // deep link: /servers?filter=online
      const q = routeQuery().get('filter') ?? undefined;
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
  usePoll(load, 10_000);
  const rx = useServerReactions(servers, loaded);
  // 30-day availability comes from the public status endpoint; the tile is simply hidden when it has no data
  usePoll(
    () => api<StatusInfo>('/status')
      .then((r) => setUptime(new Map(r.servers.filter((x) => x.uptime30 != null).map((x) => [x.id, x.uptime30 as number]))))
      .catch(() => undefined),
    5 * 60_000,
  );

  // total players over the last 24 h (the pulse strip) and planned maintenance (the news block)
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [overviewAt, setOverviewAt] = useState(0);
  usePoll(
    () => api<OverviewData>('/overview?hours=24').then((o) => { setOverview(o); setOverviewAt(Date.now()); }).catch(() => undefined),
    60_000,
  );
  const [wnOpen, toggleWn] = useWhatsNewOpen();

  const sorted = useMemo(
    () => [...servers].sort((a, b) => Number(favs.includes(b.id)) - Number(favs.includes(a.id)) || Number(b.online) - Number(a.online)),
    [servers, favs],
  );
  const online = servers.filter((s) => s.online);
  const upVals = servers.map((s) => uptime.get(s.id)).filter((v): v is number => v != null);
  const upAvg = upVals.length ? upVals.reduce((a, b) => a + b, 0) / upVals.length : null;

  // the hero by meaning: a server that needs attention, else the busiest favourite, else the busiest server
  const picked = useMemo(() => pickHero(sorted, me ? favs : []), [sorted, favs, me]);
  const hero = picked?.server ?? null;
  const heroReason: HeroReason = picked?.reason ?? null;
  // servers with a problem sit in a compact strip above the tiles (unless the hero is itself the problem: then every server is)
  const attention = heroReason === 'attention' ? [] : sorted.filter(needsAttention);
  const attentionIds = new Set(attention.map((s) => s.id));
  const rest = sorted.filter((s) => s.id !== hero?.id && !attentionIds.has(s.id));
  const offlineCount = servers.filter((s) => !s.online).length;
  const favCount = servers.filter((s) => favs.includes(s.id)).length;
  // a filter other than "all" turns the bento into a plain grid of the matching servers
  const effFilter: Filter = filter === 'fav' && !me ? 'all' : filter;
  const filtered = effFilter === 'all' ? [] : sorted.filter((s) => (effFilter === 'online' ? s.online : effFilter === 'offline' ? !s.online : favs.includes(s.id)));

  const effView: ServersView = servers.length === 0 ? 'tiles' : view;
  const visible = effFilter === 'all' ? sorted : filtered;
  const resetFilter = () => setFilter('all');

  // ---- bulk selection (administrators; not in the TV mode) ----
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<number[]>([]);
  const canSelect = isAdmin && servers.length > 0;
  const selOn = canSelect && selecting;
  const selectedServers = servers.filter((s) => sel.includes(s.id));
  const exitSelect = () => { setSelecting(false); setSel([]); };
  useEffect(() => {
    if (!selOn) return;
    const onKey = (e: KeyboardEvent) => {
      // a dialog on top closes itself first
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) exitSelect();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selOn]);
  const select: SelectProps | undefined = selOn
    ? { on: true, has: (id) => sel.includes(id), toggle: (id) => setSel((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id])) }
    : undefined;

  const open = (s: Server) => { navigate(`/servers/${s.id}`); };

  const tileProps = (s: Server, idx: number) => ({
    rx,
    s,
    idx,
    fav: me ? favs.includes(s.id) : null,
    onFav: () => void toggleFav(s.id),
    onOpen: () => open(s),
    select,
  });

  return (
    <div className="space-y-5">
      <PageHead
        title="Серверы"
        subtitle={me ? `${greeting(me.username)}. Серверы в реальном времени` : 'Состояние ваших игровых серверов в реальном времени'}
        icon={<IconServers />}
      >
        <LiveBadge at={updatedAt} />
        {isAdmin && <a className="btn btn-soft" href="/admin/servers" data-magnetic>Управление серверами</a>}
      </PageHead>

      {loaded && servers.length > 0 && (
        <PulseStrip servers={servers} overview={overview} uptime={upAvg} now={overviewAt || updatedAt} />
      )}


      {effView === 'tiles' && effFilter === 'all' && attention.length > 0 && !selOn && <AttentionStrip servers={attention} onOpen={open} />}

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
          <div className="flex flex-wrap items-center gap-2.5">
            {canSelect && (
              <button type="button" className="btn btn-soft" aria-pressed={selOn} onClick={() => (selOn ? exitSelect() : setSelecting(true))} title="Выбрать несколько серверов для массовых действий">
                {selOn ? 'Отменить выбор' : 'Выбрать'}
              </button>
            )}
            <div className="seg" role="group" aria-label="Вид списка">
              {([['tiles', 'Плитки'], ['list', 'Список'], ['chart', 'График']] as [ServersView, string][]).map(([id, label]) => (
                <button key={id} type="button" className="seg-item" aria-pressed={effView === id} onClick={() => setView(id)}>{label}</button>
              ))}
            </div>
          </div>
        </div>
      )}
      {error && servers.length === 0 ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}

      {!loaded && (effView === 'list' ? <ListSkeleton /> : <TilesSkeleton />)}

      {loaded && !error && servers.length === 0 && <NoServersState isAdmin={isAdmin} />}

      {servers.length > 0 && (
        <div className="srv-split" data-open={wnOpen}>
          {/* keyed by the filter and the view: switching them plays a short entrance (tiles come in one after another)
              instead of a jump; the periodic refresh keeps the key, so nothing flickers */}
          <div key={`${effFilter}|${effView}`} className="view-swap min-w-0 space-y-5">
            {visible.length === 0 && (
              effFilter === 'fav' && favCount === 0
                ? <NoFavsState onReset={resetFilter} />
                : <NoMatchState what={effFilter === 'offline' ? 'offline' : 'online'} onReset={resetFilter} />
            )}

            {visible.length > 0 && effView === 'list' && (
              <ServersList
                servers={visible}
                uptime={uptime}
                rx={rx}
                favOf={(id) => (me ? favs.includes(id) : null)}
                onOpen={open}
                select={select}
                renderFav={(sv, on) => <FavButton on={on} name={sv.name} onClick={() => void toggleFav(sv.id)} className={on ? 'text-warn' : 'text-mute'} />}
              />
            )}

            {effView === 'chart' && visible.length > 0 && <CompareChart servers={visible} />}

            {effView === 'tiles' && effFilter !== 'all' && visible.length > 0 && (
              <div className="fade-in srv-grid">
                {filtered.map((s, i) => <SmallTile key={s.id} {...tileProps(s, i)} />)}
              </div>
            )}

            {effView === 'tiles' && effFilter === 'all' && (
              <div className="fade-in srv-grid">
                {hero && <HeroTile key={hero.id} {...tileProps(hero, 0)} reason={heroReason} uptime={uptime.get(hero.id)} />}
                {rest.map((s, i) => <SmallTile key={s.id} {...tileProps(s, i + 1)} />)}
              </div>
            )}
          </div>
          <WhatsNew open={wnOpen} onToggle={toggleWn} overview={overview} />
        </div>
      )}

      {selOn && (
        <BulkBar
          selected={selectedServers}
          visible={visible}
          favs={favs}
          onSelectAll={() => setSel(visible.map((s) => s.id))}
          onClear={() => setSel([])}
          onExit={exitSelect}
          onReload={() => void load()}
          onFavs={setFavs}
        />
      )}
    </div>
  );
}

/** the checkbox of the selection mode in a corner of a card */
function CardCheck({ s, select, className = '' }: { s: Server; select: SelectProps; className?: string }) {
  return (
    <input
      type="checkbox"
      className={`srv-check srv-check-card ${className}`}
      checked={select.has(s.id)}
      onChange={() => select.toggle(s.id)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Выбрать: ${s.name}`}
    />
  );
}

/** in the selection mode a link toggles the card instead of leaving the page */
const linkClick = (s: Server, select?: SelectProps) => (e: MouseEvent<HTMLElement>) => {
  e.stopPropagation();
  if (select?.on) {
    e.preventDefault();
    select.toggle(s.id);
  }
};

function HeroTile({ s, idx, uptime, fav, onFav, onOpen, rx, reason, select }: { rx: Reactions; s: Server; idx: number; uptime?: number; fav: boolean | null; onFav: () => void; onOpen: () => void; reason: HeroReason; select?: SelectProps }) {
  const sparkSpan = useSparkSpanMin(s.id);
  useI18n();
  const [c1, c2] = gameGradient(s.game);
  const lag = isLag(s);
  const depth = useDepth<HTMLElement>();
  const r = reactionOf(rx, s.id);
  const emb = emblemStyle(s.coverUrl, s.game);
  return (
    <article
      className={`${emb.className ? 'emblem-host' : ''} ${s.online ? 'is-split' : ''} srv-hero depth tile-in tile-hover relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-[26px] p-5 text-white shadow-soft lg:p-6 ${reason === 'attention' ? 'hero-attn' : ''} ${s.online ? '' : 'is-down'}`}
      style={{
        ...stagger(idx),
        ...emb.style,
        background: coverBackground(s.coverUrl, gameBackdrop(c1), { strong: true, game: s.game }),
        boxShadow: `${select?.has(s.id) ? '0 0 0 3px rgb(var(--brand)), ' : reason === 'attention' ? `0 0 0 3px rgb(var(${s.online ? '--warn' : '--bad'}) / .85), ` : ''}0 1px 2px rgba(20,24,40,.06), 0 18px 40px -12px ${c1}88`,
      }}
      onClick={select?.on ? () => select.toggle(s.id) : onOpen}
      {...depth}
    >
      {emb.className && <span aria-hidden className="emblem-layer" />}
      <span aria-hidden className="depth-l1 pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/15" />
      <span aria-hidden className="depth-l2 pointer-events-none absolute -bottom-24 -left-10 h-52 w-52 rounded-full bg-black/10" />
      {select?.on && <CardCheck s={s} select={select} className="left-2 top-2" />}

      <div className="sh-head relative flex items-start gap-3">
        <GameAvatar game={s.game} size={48} glass vtId={s.id} />
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 wrap-break-word text-lg font-extrabold leading-tight sm:text-xl" title={s.name}>
            <a href={`/servers/${s.id}`} onClick={linkClick(s, select)} className="hover:underline">{s.name}</a>
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] font-bold text-white/90">
            <span>{gameLabel(s.game)}</span>
            <span aria-hidden>·</span>
            <code className="truncate font-mono text-xs font-semibold" title={s.address}>{s.address}</code>
          </div>
          {s.maintenance && <MaintenanceChip m={s.maintenance} glass className="mt-1.5" />}
          {reason && reason !== 'attention' && <span className="hero-reason">{t(`srv.hero.${reason}` as const)}</span>}
        </div>
        <div className="sh-actions flex shrink-0 items-center gap-1">
          <StatusFlash r={r}><StatusPill glass online={s.online} known={s.hasStatus} lag={lag} maintenance={!!s.maintenance} /></StatusFlash>
          {fav != null && <FavButton on={fav} name={s.name} onClick={onFav} className={fav ? 'text-white' : 'text-white/80'} glass />}
        </div>
      </div>

      {s.online ? (
        <>
          <div className="sh-count relative flex flex-wrap items-baseline gap-x-2.5 gap-y-1 pt-1">
            <CountReact r={r} onDark><AnimatedNumber value={s.players} className="text-[64px] font-extrabold leading-none tracking-[-0.045em] sm:text-[78px]" /></CountReact>
            <span className="text-lg font-bold text-white/90">/ {s.maxPlayers} {plural(s.maxPlayers, ['игрок', 'игрока', 'игроков'])}</span>
            {s.ping != null && <span className="ml-auto font-bold text-white/90">пинг {s.ping} мс</span>}
          </div>
          <CapacityBar className="sh-bar relative" players={s.players} max={s.maxPlayers} color="#fff" onDark />
          <div className="sh-chart relative mt-auto pt-2">
            <Spark serverId={s.id} color="#ffffff" variant="hero" />
          </div>
        </>
      ) : (
        // a server that is down: one compact row (what is wrong, since when) and the day's curve with the outage in red
        <div className="relative grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {s.hasStatus ? (
            <div className="rounded-2xl bg-white/20 px-4 py-3" title={s.error ?? undefined}>
              <p className="line-clamp-3 text-base font-extrabold leading-snug">{s.error ?? 'Сервер не отвечает'}</p>
              <p className="mt-1 text-sm font-semibold text-white/85">Последний ответ: {ago(s.updatedAt)}</p>
            </div>
          ) : (
            <div className="rounded-2xl bg-white/20 px-4 py-3 text-base font-extrabold">Ожидаем первый ответ</div>
          )}
          <Spark serverId={s.id} color="#ffffff" variant="hero" />
        </div>
      )}

      <div className="sh-foot relative mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px] font-bold text-white/90">
        <span>{spanCaption(sparkSpan)}</span>
        {uptime != null && <span>аптайм {(Math.round(uptime * 10) / 10).toLocaleString('ru-RU')}%</span>}
        <span className="truncate">{s.online && s.map ? `карта ${s.map}` : `обновлено ${ago(s.updatedAt)}`}</span>
      </div>
    </article>
  );
}

function SmallTile({ s, idx, fav, onFav, onOpen, rx, select }: { rx: Reactions; s: Server; idx: number; fav: boolean | null; onFav: () => void; onOpen: () => void; select?: SelectProps }) {
  const [c1, c2] = gameGradient(s.game);
  const lag = isLag(s);
  const r = reactionOf(rx, s.id);
  const emb = emblemStyle(s.coverUrl, s.game);
  return (
    <article
      className={`srv-tile tile tile-in tile-hover relative flex cursor-pointer flex-col gap-2 p-3 pb-4 ${select?.has(s.id) ? 'srv-selected' : ''} ${s.online ? '' : 'is-down'} ${s.online && s.maxPlayers > 0 && s.players / s.maxPlayers >= 0.8 ? 'is-busy' : ''}`}
      // the fuller the server, the stronger its glow in the game's colour
      style={{ ...stagger(idx), ['--gc' as string]: gameColor(s.game), ['--fill' as string]: s.online && s.maxPlayers > 0 ? Math.min(1, s.players / s.maxPlayers).toFixed(2) : '0' }}
      onClick={select?.on ? () => select.toggle(s.id) : onOpen}
    >
      {select?.on && <CardCheck s={s} select={select} className="left-1 top-1" />}
      <div className={`${emb.className} flex h-[124px] items-start justify-between rounded-[18px] p-3 ${s.online ? '' : 'offline-cover'}`} style={{ ...emb.style, background: coverBackground(s.coverUrl, gameBackdrop(c1, 135), { small: true, game: s.game }), boxShadow: `inset 0 -3px 0 ${gameColor(s.game)}` }}>
        <GameAvatar game={s.game} size={46} glass vtId={s.id} />
        <div className="flex items-center gap-0.5">
          <StatusFlash r={r}><StatusPill glass online={s.online} known={s.hasStatus} lag={lag} maintenance={!!s.maintenance} /></StatusFlash>
          {fav != null && <FavButton on={fav} name={s.name} onClick={onFav} className={fav ? 'text-white' : 'text-white/85'} glass />}
        </div>
      </div>

      <div className="px-1.5">
        <h3 className="line-clamp-2 wrap-break-word text-[16.5px] font-extrabold leading-tight" title={s.name}>
          <a href={`/servers/${s.id}`} onClick={linkClick(s, select)} className="hover:text-link">{s.name}</a>
        </h3>
        <div className="mt-0.5 truncate text-[13px] font-bold text-mute">{gameLabel(s.game)}</div>
        {s.maintenance && <MaintenanceChip m={s.maintenance} className="mt-1" />}
      </div>

      {s.online ? (
        <>
          <div className="flex items-baseline gap-1.5 px-1.5">
            <CountReact r={r}><AnimatedNumber value={s.players} className="text-[38px] font-extrabold leading-none tracking-[-0.03em]" /></CountReact>
            <span className="text-[17px] font-bold text-mute">/ {s.maxPlayers}</span>
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
