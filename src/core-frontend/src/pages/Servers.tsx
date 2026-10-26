import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { api, type Server, type StatusInfo } from '../api';
import { useAuth } from '../auth';
import { gameColor, gameGradient, gameLabel } from '../games';
import { coverBackground, emblemStyle, gameBackdrop } from '../cover';
import MaintenanceChip from '../components/MaintenanceChip';
import { AnimatedNumber, Burst, ErrorLine, GameAvatar, LoadError, IconServers, PageHead, Spark, StatusPill, ago, isLag, plural, spanCaption, useDepth, useSparkSpanMin, usePoll, navigate, routeQuery } from '../ui';
import { t, useI18n } from '../i18n';
import { calmSeriesColor, useCoverAccent } from '../components/server/coverAccent';
import { pingTone, TONE_TEXT } from '../components/server/helpers';
import { AddrCopy, CapacityBar, CountReact, ListSkeleton, NoFavsState, NoMatchState, NoServersState, PingBars, PlayerNames, StatusFlash, TilesSkeleton, TrendChip, durText, reactionOf, useServerReactions, type Reactions } from '../components/servers/serverUi';
import { ServersList, readView, saveView, type ListSort, type SelectProps, type ServersView } from '../components/servers/ServerViews';
import CompareChart from '../components/servers/CompareChart';
import { QuickMenu } from '../components/servers/QuickMenu';
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
const SIZE_KEY = 'coregsm_srv_size';
const PULL_AT = 70;

/** the sort of the list view: a column and a direction */
function sortServers(list: Server[], sort: ListSort, uptime: Map<number, number>): Server[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const val = (s: Server): number | string => (sort.key === 'name' ? s.name.toLowerCase() : sort.key === 'players' ? (s.online ? s.players : -1) : sort.key === 'ping' ? (s.online && s.ping != null ? s.ping : Infinity) : uptime.get(s.id) ?? -1);
  return [...list].sort((a, b) => {
    const x = val(a), y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

/** pull down from the very top of the page (touch): returns the current pull in px, calls `onPull` after a long enough pull */
function usePullToRefresh(onPull: () => void): number {
  const [pull, setPull] = useState(0);
  // the latest callback without re-subscribing (a re-subscription in the middle of a touch would forget where it began)
  const cb = useRef(onPull);
  cb.current = onPull;
  useEffect(() => {
    let y0: number | null = null;
    let cur = 0;
    const start = (e: TouchEvent) => { y0 = window.scrollY <= 0 ? e.touches[0].clientY : null; cur = 0; };
    const move = (e: TouchEvent) => {
      if (y0 == null) return;
      cur = Math.max(0, Math.min(110, (e.touches[0].clientY - y0) * 0.5));
      setPull(cur);
    };
    const end = () => {
      if (y0 != null && cur >= PULL_AT) cb.current();
      y0 = null;
      cur = 0;
      setPull(0);
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, []);
  return pull;
}

const ViewIcon = ({ id }: { id: ServersView }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {id === 'tiles' ? <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></> : id === 'list' ? <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /> : <path d="M3 3v18h18M7 15l4-5 3 3 5-7" />}
  </svg>
);

/** a round «наверх» button once the page is scrolled a screen or two */
function ScrollTop() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const f = () => setOn(window.scrollY > 700);
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  if (!on) return null;
  return (
    <button type="button" className="srv-top" aria-label={t('srv.top')} title={t('srv.top')} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m18 15-6-6-6 6" /></svg>
    </button>
  );
}

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
      className={`${glass ? 'btn-icon-glass btn-icon-sm' : 'btn-icon-ghost btn-icon-sm'} ${on ? '' : 'star-quiet'}`}
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
function LiveBadge({ at, onRefresh, busy }: { at: number; onRefresh: () => void; busy: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 5000);
    return () => window.clearInterval(t);
  }, []);
  if (!at) return null;
  return (
    <button type="button" className="srv-live" title="Страница обновляется сама. Нажмите, чтобы обновить сейчас" onClick={onRefresh} aria-busy={busy || undefined}>
      <span className="live-dot" aria-hidden />
      {busy ? 'обновляю…' : `обновлено ${ago(at)}`}
    </button>
  );
}

/** a phone (under the Tailwind `sm` width): the tiles become compact rows */
function useIsPhone(): boolean {
  const q = '(max-width: 639px)';
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return on;
}

function ServerList() {
  const phone = useIsPhone();
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
  // when the running outage of a server began (the public status endpoint knows it, the poll time does not)
  const [downSince, setDownSince] = useState<Map<number, number>>(new Map());
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
  // a tap on «обновлено …» or a pull down from the top of the page refreshes at once
  const [refreshing, setRefreshing] = useState(false);
  const refreshNow = async () => {
    setRefreshing(true);
    await load();
    setTimeout(() => setRefreshing(false), 400);
  };
  const pull = usePullToRefresh(() => refreshNow());
  // tile size and the sort of the list view
  const [size, setSizeState] = useState<'s' | 'm' | 'l'>(() => { try { const v = localStorage.getItem(SIZE_KEY); return v === 's' || v === 'l' ? v : 'm'; } catch { return 'm'; } });
  const setSize = (v: 's' | 'm' | 'l') => { setSizeState(v); try { localStorage.setItem(SIZE_KEY, v); } catch { /* not remembered */ } };
  const [listSort, setListSort] = useState<ListSort | null>(null);
  const rx = useServerReactions(servers, loaded);
  // 30-day availability comes from the public status endpoint; the tile is simply hidden when it has no data
  usePoll(
    () => api<StatusInfo>('/status')
      .then((r) => {
        setUptime(new Map(r.servers.filter((x) => x.uptime30 != null).map((x) => [x.id, x.uptime30 as number])));
        setDownSince(new Map((r.incidents ?? []).filter((i) => i.end == null && !i.planned).map((i) => [i.serverId, i.start])));
      })
      .catch(() => undefined),
    60_000,
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
  // (the problem servers are named in the alert row of the pulse strip and sit first among the tiles)
  const rest = sorted.filter((s) => s.id !== hero?.id).sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)));
  const offlineCount = servers.filter((s) => !s.online).length;
  const liveLine = servers.length ? t('srv.sub.live', { n: online.reduce((a, s) => a + s.players, 0), s: online.length, total: servers.length }) : t('srv.sub.empty');
  const favCount = servers.filter((s) => favs.includes(s.id)).length;
  // a filter other than "all" turns the bento into a plain grid of the matching servers
  const effFilter: Filter = filter === 'fav' && !me ? 'all' : filter;
  const filtered = effFilter === 'all' ? [] : sorted.filter((s) => (effFilter === 'online' ? s.online : effFilter === 'offline' ? !s.online : favs.includes(s.id)));

  const effView: ServersView = servers.length === 0 ? 'tiles' : view;
  const visible0 = effFilter === 'all' ? sorted : filtered;
  const visible = effView === 'list' && listSort ? sortServers(visible0, listSort, uptime) : visible0;
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

  const Tile = phone ? PhoneRow : SmallTile;
  const tileProps = (s: Server, idx: number) => ({
    rx,
    s,
    idx,
    fav: me ? favs.includes(s.id) : null,
    onFav: () => void toggleFav(s.id),
    onOpen: () => open(s),
    select,
    uptime: uptime.get(s.id),
    downSince: downSince.get(s.id),
  });

  return (
    <div className="space-y-5">
      <PageHead
        title="Серверы"
        subtitle={me ? `${greeting(me.username)}. ${liveLine}` : liveLine}
        icon={<IconServers />}
      >
        <span className="srv-head-actions">
          <LiveBadge at={updatedAt} onRefresh={() => void refreshNow()} busy={refreshing} />
          {isAdmin && <a className="btn btn-soft btn-sm" href="/admin/servers" data-magnetic>Управление серверами</a>}
        </span>
      </PageHead>

      {loaded && servers.length > 0 && (
        <PulseStrip servers={servers} overview={overview} uptime={upAvg} now={overviewAt || updatedAt} onOpen={open} />
      )}


      {servers.length > 0 && (
        <div className="srv-bar" id="srv-list">
          {servers.length > 1 ? (
            <nav className="seg fade-x no-scrollbar flex w-fit max-w-full overflow-x-auto" aria-label="Фильтр серверов">
              {([
                ['all', `Все · ${servers.length}`, servers.length],
                ['online', `Онлайн · ${online.length}`, online.length],
                ['offline', `Недоступные · ${offlineCount}`, offlineCount],
                ...(me ? [['fav', `Избранные · ${favCount}`, favCount]] : []),
              ] as [Filter, string, number][]).filter(([id, , count]) => id !== 'offline' || count > 0 || effFilter === id).map(([id, label, count]) => (
                // an empty filter stays reachable but is dimmed, so the eye goes to the ones that have servers
                <button key={id} type="button" className={`seg-item whitespace-nowrap${count === 0 && effFilter !== id ? ' opacity-70' : ''}`} aria-pressed={effFilter === id} onClick={() => setFilter(id)}>{label}</button>
              ))}
            </nav>
          ) : <span />}
          <div className="srv-bar-tools flex items-center gap-2.5">
            {canSelect && (
              <button type="button" className="btn btn-ghost btn-sm" aria-pressed={selOn} onClick={() => (selOn ? exitSelect() : setSelecting(true))} title="Выбрать несколько серверов для массовых действий">
                {selOn ? 'Отменить выбор' : 'Выбрать'}
              </button>
            )}
            {effView === 'tiles' && (
              <div className="seg max-sm:hidden" role="group" aria-label="Размер плиток">
                {([['s', 'S', 'Компактные'], ['m', 'M', 'Обычные'], ['l', 'L', 'Крупные']] as const).map(([id, mark, label]) => (
                  <button key={id} type="button" className="seg-item" aria-pressed={size === id} title={label} aria-label={label} onClick={() => setSize(id)}>{mark}</button>
                ))}
              </div>
            )}
            <div className="seg" role="group" aria-label="Вид списка">
              {([['tiles', 'Плитки'], ['list', 'Список'], ['chart', 'График']] as [ServersView, string][]).map(([id, label]) => (
                <button key={id} type="button" className="seg-item srv-view-btn" aria-pressed={effView === id} title={label} onClick={() => setView(id)}>
                  <ViewIcon id={id} /><span className="max-sm:sr-only">{label}</span>
                </button>
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
                sort={listSort}
                onSort={(k) => setListSort((cur) => (cur?.key === k ? (cur.dir === 'asc' ? { key: k, dir: 'desc' } : null) : { key: k, dir: k === 'name' || k === 'ping' ? 'asc' : 'desc' }))}
                rx={rx}
                favOf={(id) => (me ? favs.includes(id) : null)}
                onOpen={open}
                select={select}
                renderFav={(sv, on) => <><FavButton on={on} name={sv.name} onClick={() => void toggleFav(sv.id)} className={on ? 'text-warn' : 'text-mute'} /><QuickMenu s={sv} /></>}
              />
            )}

            {effView === 'chart' && visible.length > 0 && <CompareChart servers={visible} />}

            {effView === 'tiles' && effFilter !== 'all' && visible.length > 0 && (
              <div className="fade-in srv-grid" data-size={size}>
                {filtered.map((s, i) => <Tile key={s.id} {...tileProps(s, i)} />)}
              </div>
            )}

            {effView === 'tiles' && effFilter === 'all' && (
              <div className="fade-in srv-grid" data-size={size}>
                {hero && <HeroTile key={hero.id} {...tileProps(hero, 0)} reason={heroReason} />}
                {rest.map((s, i) => <Tile key={s.id} {...tileProps(s, i + 1)} />)}
              </div>
            )}
          </div>
          <WhatsNew open={wnOpen} onToggle={toggleWn} overview={overview} />
        </div>
      )}

      <ScrollTop />
      {pull > 0 && <div className="srv-pull" style={{ height: pull }} aria-hidden>{pull >= PULL_AT ? 'Отпустите, чтобы обновить' : 'Потяните вниз'}</div>}

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

function HeroTile({ s, idx, uptime, downSince, fav, onFav, onOpen, rx, reason, select }: { rx: Reactions; s: Server; idx: number; uptime?: number; downSince?: number; fav: boolean | null; onFav: () => void; onOpen: () => void; reason: HeroReason; select?: SelectProps }) {
  const sparkSpan = useSparkSpanMin(s.id);
  useI18n();
  const [c1, c2] = gameGradient(s.game);
  const lag = isLag(s);
  const depth = useDepth<HTMLElement>();
  const r = reactionOf(rx, s.id);
  const emb = emblemStyle(s.coverUrl, s.game);
  return (
    <article
      className={`${emb.className ? 'emblem-host' : ''} ${s.online ? 'is-split' : ''} srv-hero depth tile-in tile-hover relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-ui-xl p-5 text-white shadow-soft lg:p-6 ${reason === 'attention' ? 'hero-attn' : ''} ${s.online ? '' : 'is-down'}`}
      style={{
        ...stagger(idx),
        ...emb.style,
        ['--gc' as string]: gameColor(s.game),
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
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-fs-sm font-bold text-white/90">
            <span>{gameLabel(s.game)}</span>
            <span aria-hidden>·</span>
            <AddrCopy address={s.address} className="truncate font-mono text-xs font-semibold" />
          </div>
          {s.maintenance && <MaintenanceChip m={s.maintenance} glass className="mt-1.5" />}
          {reason && reason !== 'attention' && <span className="hero-reason">{t(`srv.hero.${reason}` as const)}</span>}
        </div>
        <div className="sh-actions flex shrink-0 items-center gap-1">
          <StatusFlash r={r}><StatusPill glass online={s.online} known={s.hasStatus} lag={lag} maintenance={!!s.maintenance} /></StatusFlash>
          {fav != null && <FavButton on={fav} name={s.name} onClick={onFav} className={fav ? 'text-white' : 'text-white/80'} glass />}
          <QuickMenu s={s} glass />
        </div>
      </div>

      {s.online ? (
        <>
          <div className="sh-count relative flex flex-wrap items-baseline gap-x-2.5 gap-y-1 pt-1">
            <CountReact r={r} onDark><AnimatedNumber value={s.players} className="text-[64px] font-extrabold leading-none tracking-[-0.045em] sm:text-[78px]" /></CountReact>
            <span className="text-lg font-bold text-white/90">/ {s.maxPlayers} {plural(s.maxPlayers, ['игрок', 'игрока', 'игроков'])}</span>
            <span aria-hidden className="sh-br" />
            <TrendChip serverId={s.id} onDark />
            {s.ping != null && <span className="ml-auto inline-flex items-center gap-1.5 font-bold text-white/90"><PingBars ping={s.ping} tone={pingTone(s.ping).tone} />пинг {s.ping} мс</span>}
          </div>
          <CapacityBar className="sh-bar relative" players={s.players} max={s.maxPlayers} color="#fff" onDark />
          <PlayerNames className="relative" names={s.playerNames ?? []} onDark />
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
              <p className="mt-1 text-sm font-semibold text-white/85">{downSince ? t('srv.down.for', { d: durText(Date.now() - downSince) }) + ' · ' : ''}Последний ответ: {ago(s.updatedAt)}</p>
            </div>
          ) : (
            <div className="rounded-2xl bg-white/20 px-4 py-3 text-base font-extrabold">Ожидаем первый ответ</div>
          )}
          <Spark serverId={s.id} color="#ffffff" variant="hero" />
        </div>
      )}

      <div className="sh-foot relative mt-auto flex flex-wrap items-center gap-1.5 text-fs-sm font-bold text-white/90">
        <span className="sh-chip">{spanCaption(sparkSpan)}</span>
        {uptime != null && <span className="sh-chip">аптайм {(Math.round(uptime * 10) / 10).toLocaleString('ru-RU')}%</span>}
        {s.online && s.map && <span className="sh-chip">карта {s.map}</span>}
        {s.version && <span className="sh-chip">v{s.version}</span>}
        {!s.online && <span className="sh-chip">обновлено {ago(s.updatedAt)}</span>}
      </div>
    </article>
  );
}

/** the phone version of a tile: one row (emblem, name with a thin bar, players, status dot) at least 56 px high */
function PhoneRow({ s, idx, fav, onFav, onOpen, select }: { rx: Reactions; s: Server; idx: number; fav: boolean | null; onFav: () => void; onOpen: () => void; select?: SelectProps; uptime?: number; downSince?: number }) {
  useI18n();
  const lag = isLag(s);
  const tone = !s.hasStatus ? 'bg-mute' : !s.online ? 'bg-bad' : lag || s.maintenance ? 'bg-warn' : 'bg-ok';
  return (
    <article
      className={`srv-row tile-in relative ${select?.has(s.id) ? 'srv-selected' : ''} ${s.online ? '' : 'is-down'}`}
      style={stagger(idx)}
      onClick={select?.on ? () => select.toggle(s.id) : onOpen}
    >
      {select?.on && <CardCheck s={s} select={select} className="left-1 top-1" />}
      <GameAvatar game={s.game} size={40} vtId={s.id} />
      <div className="srv-row-main">
        <h3 className="truncate text-fs-base font-extrabold leading-tight" title={s.name}>
          <a href={`/servers/${s.id}`} onClick={linkClick(s, select)}>{s.name}</a>
        </h3>
        {s.online ? (
          <CapacityBar className="srv-row-bar" players={s.players} max={s.maxPlayers} color="rgb(var(--ink) / .5)" showPct={false} slots={false} />
        ) : (
          <p className="truncate text-fs-sm font-semibold text-mute">{s.hasStatus ? `Не отвечает · ${ago(s.updatedAt)}` : 'Ожидаем первый ответ'}</p>
        )}
      </div>
      <div className="srv-row-count">
        {s.online ? <><b>{s.players}</b><span>/{s.maxPlayers}</span></> : <span>–</span>}
      </div>
      <span className={`srv-row-dot ${tone}`} aria-hidden />
      {fav != null && <FavButton on={fav} name={s.name} onClick={onFav} className={fav ? 'text-warn' : 'text-mute'} />}
    </article>
  );
}

function SmallTile({ s, idx, fav, onFav, onOpen, rx, select, uptime, downSince }: { rx: Reactions; s: Server; idx: number; fav: boolean | null; onFav: () => void; onOpen: () => void; select?: SelectProps; uptime?: number; downSince?: number }) {
  const [who, setWho] = useState(false);
  const [c1, c2] = gameGradient(s.game);
  // the accent is taken from the cover picture, so two games of the same colour family still look different
  const accent = calmSeriesColor(useCoverAccent(s.coverUrl, gameColor(s.game)), gameColor(s.game));
  const lag = isLag(s);
  const r = reactionOf(rx, s.id);
  const emb = emblemStyle(s.coverUrl, s.game);
  const nearFull = s.online && s.maxPlayers > 0 && s.players / s.maxPlayers >= 0.8;
  return (
    <article
      className={`srv-tile tile tile-in tile-hover relative flex cursor-pointer flex-col gap-2 p-3 pb-4 ${select?.has(s.id) ? 'srv-selected' : ''} ${s.online ? '' : 'is-down'} ${nearFull ? 'is-busy' : ''} ${s.online && lag ? 'is-lag' : ''}`}
      // the fuller the server, the stronger its glow in the game's colour
      style={{ ...stagger(idx), ['--gc' as string]: accent, ['--fill' as string]: s.online && s.maxPlayers > 0 ? Math.min(1, s.players / s.maxPlayers).toFixed(2) : '0' }}
      onClick={select?.on ? () => select.toggle(s.id) : onOpen}
    >
      {select?.on && <CardCheck s={s} select={select} className="left-1 top-1" />}
      <div className={`${emb.className} relative flex h-[124px] items-start justify-between rounded-ui-lg p-3 ${s.online ? '' : 'offline-cover'}`} style={{ ...emb.style, background: coverBackground(s.coverUrl, gameBackdrop(c1, 135), { small: true, game: s.game }) }}>
        <span aria-hidden className="cover-scrim" />
        <GameAvatar game={s.game} size={46} glass vtId={s.id} />
        <div className="flex items-center gap-0.5">
          <StatusFlash r={r}><StatusPill glass online={s.online} known={s.hasStatus} lag={lag} maintenance={!!s.maintenance} /></StatusFlash>
          {fav != null && <FavButton on={fav} name={s.name} onClick={onFav} className={fav ? 'text-white' : 'text-white/85'} glass />}
          <QuickMenu s={s} glass />
        </div>
      </div>

      <div className="px-1.5">
        <h3 className="srv-name truncate text-fs-lg font-extrabold leading-tight" title={s.name}>
          <a href={`/servers/${s.id}`} onClick={linkClick(s, select)} className="hover:text-link">{s.name}</a>
        </h3>
        <div className="srv-chips">{nearFull && <span className="srv-badge-full" title={t('srv.cap.nearFull', { pct: Math.round((s.players / s.maxPlayers) * 100) })}>{t('srv.tile.full')}</span>}<span className="truncate">{gameLabel(s.game)}</span>{s.online && s.map && <span className="srv-chip" title={`Карта: ${s.map}`}>{s.map}</span>}{s.version && <span className="srv-chip" title="Версия">v{s.version}</span>}</div>
        {s.maintenance && <MaintenanceChip m={s.maintenance} className="mt-1" />}
      </div>

      {s.online ? (
        <>
          <div className={`srv-count flex items-baseline gap-1.5 px-1.5 ${s.players === 0 ? 'srv-zero' : ''}`}>
            <CountReact r={r}><AnimatedNumber value={s.players} className="text-[38px] font-extrabold leading-none tracking-[-0.03em]" /></CountReact>
            <span className="text-fs-xl font-bold text-mute">/ {s.maxPlayers}</span>
            <TrendChip serverId={s.id} />
            {(s.playerNames?.length ?? 0) > 0 && <button type="button" className="srv-who" aria-expanded={who} onClick={(e) => { e.stopPropagation(); setWho((v) => !v); }}>{t('srv.who')}</button>}
            <span className={`ml-auto inline-flex items-center gap-1.5 text-fs-sm font-bold ${s.ping != null ? TONE_TEXT[pingTone(s.ping).tone] : 'text-mute'}`}>{s.ping != null && <><PingBars ping={s.ping} tone={pingTone(s.ping).tone} />{`${s.ping} мс`}</>}</span>
          </div>
          <CapacityBar className="px-1.5" players={s.players} max={s.maxPlayers} color="rgb(var(--ink) / .5)" />
          {who && <PlayerNames className="px-1.5" names={s.playerNames ?? []} max={12} />}
          {s.players === 0
            ? <p className="srv-empty-now"><i aria-hidden />{t('srv.empty.now')}</p>
            : <div className="px-1.5"><Spark serverId={s.id} color={accent} /></div>}
        </>
      ) : (
        s.hasStatus ? (
          <div className="mx-1.5 flex items-center gap-2 rounded-xl bg-badbg px-3 py-2" title={s.error ?? undefined}>
            <span className="h-2 w-2 shrink-0 rounded-full bg-bad" aria-hidden />
            <p className="truncate text-fs-sm font-bold leading-snug text-bad">{downSince ? t('srv.down.for', { d: durText(Date.now() - downSince) }) : `Не отвечает · ${ago(s.updatedAt)}`}</p>
          </div>
        ) : (
          <div className="mx-1.5 rounded-xl bg-soft px-3 py-2.5 text-fs-sm font-bold text-mute">Ожидаем первый ответ</div>
        )
      )}

      <div className="mt-auto flex items-center justify-between gap-2 px-1.5 pt-1 text-xs font-bold text-mute">
        <AddrCopy address={s.address} className="truncate font-mono" />
        <span className="flex shrink-0 items-center gap-2">
          {uptime != null && <span className="srv-up" title="Аптайм за 30 дней">{(Math.round(uptime * 10) / 10).toLocaleString('ru-RU')}%</span>}
          {s.online ? (s.updatedAt != null && Date.now() - s.updatedAt > 120_000 ? ago(s.updatedAt) : '') : ago(s.updatedAt)}
        </span>
      </div>
    </article>
  );
}
