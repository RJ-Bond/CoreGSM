import { useLive } from '../ui/live';
import { haptic } from '../ui/haptic';
import { useAppearance } from '../appearance';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { lonelyTile, useGridColumns } from '../components/servers/gridLogic';
import { pickHeroBy, readHeroMode, saveHeroMode, type HeroMode } from '../components/servers/heroLogic';
import { HomeBlocksMenu, useHomeBlocks } from '../components/servers/HomeBlocks';
import { api, type Server, type StatusInfo } from '../api';
import { useAuth } from '../auth';
import LiveBadge from '../components/LiveBadge';
import { ErrorLine, LoadError, IconServers, PageHead, usePoll, toast, navigate, routeQuery } from '../ui';
import { t, useI18n, type TKey } from '../i18n';
import { ListSkeleton, NoFavsState, NoMatchState, NoServersState, TilesSkeleton, useServerReactions } from '../components/servers/serverUi';
import { ServersList, readView, saveView, type ListSort, type SelectProps, type ServersView } from '../components/servers/ServerViews';
import CompareChart from '../components/servers/CompareChart';
import { QuickMenu } from '../components/servers/QuickMenu';
import { PulseStrip } from '../components/servers/PulseStrip';
import { WhatsNew, useWhatsNewOpen } from '../components/servers/WhatsNew';
import { BulkBar } from '../components/servers/BulkBar';
import { needsAttention, type HeroReason, type OverviewData } from '../components/servers/overviewLogic';
import NotFound from '../components/NotFound';
import ServerDetail, { SERVER_TABS } from './ServerDetail';
import { FavButton, HeroTile, PhoneRow, SmallTile, readOrder, saveOrder, type TileDnd } from '../components/servers/Tiles';

/** /servers/rust-main: finds the number of the server by its short name and opens the usual address */
function SlugGate({ slug, tab }: { slug: string; tab: string }) {
  useI18n();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let off = false;
    api<{ id: number }>(`/servers/by-slug/${encodeURIComponent(slug)}`)
      .then((r) => { if (off) return; if (Number.isInteger(r?.id) && r.id > 0) navigate(`/servers/${r.id}${tab ? `/${tab}` : ''}`, { replace: true }); else setMissing(true); })
      .catch(() => { if (!off) setMissing(true); });
    return () => { off = true; };
  }, [slug, tab]);
  if (missing) return <NotFound kind="server" />;
  return <div className="skeleton h-40" aria-busy="true" />;
}

export default function ServersPage({ sub }: { sub: string }) {
  // "12/players" -> server 12, tab "players"
  const [idPart = '', tabPart = ''] = sub.split('/');
  const id = Number(idPart);
  const tab = (SERVER_TABS as readonly string[]).includes(tabPart) ? tabPart : '';
  if (idPart && /^\d+$/.test(idPart) && Number.isInteger(id) && id > 0 && (!tabPart || tab)) return <ServerDetail id={id} tab={tab} />;
  // "/servers/rust-main": a short name of a server
  if (idPart && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(idPart) && !/^\d+$/.test(idPart) && (!tabPart || tab)) return <SlugGate slug={idPart} tab={tab} />;
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
  const hello = h >= 5 && h < 12 ? t('d2.srv.morning') : h >= 12 && h < 18 ? t('d2.srv.afternoon') : h >= 18 && h < 23 ? t('d2.srv.evening') : t('d2.srv.night');
  return `${hello}, ${name.trim() || name}`;
}


type Filter = 'all' | 'online' | 'offline' | 'fav';
const FILTER_KEY = 'coregsm_server_filter';


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
  useI18n();
  const phone = useIsPhone();
  const { me, isAdmin } = useAuth();
  const [look] = useAppearance();
  const ember = look.ember;
  const [favs, setFavs] = useState<number[]>([]);
  const [favsLoaded, setFavsLoaded] = useState(false);
  const [filterPicked, setFilterPicked] = useState(false);
  useEffect(() => {
    if (me) api<number[]>('/favorites').then((r) => { setFavs(r); setFavsLoaded(true); }).catch(() => undefined);
    else setFavs([]);
  }, [me]);
  const toggleFav = async (id: number) => {
    const on = favs.includes(id);
    haptic('tap');
    setFavs(on ? favs.filter((x) => x !== id) : [...favs, id]);
    // the star changes at once; when the server refuses, it goes back and says so
    await api(`/favorites/${id}`, on ? 'DELETE' : 'PUT').catch(() => { setFavs(favs); toast(t('srv.fav.failed'), 'err'); });
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
    setFilterPicked(true);
    setFilterState(f);
    try {
      localStorage.setItem(FILTER_KEY, f);
    } catch {
      /* not remembered */
    }
  };

  // the remembered «Favourites» filter must not leave a person with an empty list: while nothing is starred it falls back to «All»
  useEffect(() => {
    if (!favsLoaded || filterPicked || favs.length > 0 || filter !== 'fav') return;
    setFilterState('all');
    try { localStorage.setItem(FILTER_KEY, 'all'); } catch { /* not remembered */ }
  }, [favsLoaded, filterPicked, favs, filter]);

  const [view, setViewState] = useState<ServersView>(readView);
  const setView = (v: ServersView) => { setViewState(v); saveView(v); };

  const load = () =>
    api<Server[]>('/servers')
      .then((s) => { setServers(s); setError(''); setUpdatedAt(Date.now()); })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  // the server tells the panel when something was polled; the timer is then only a safety net
  const live = useLive(load);
  usePoll(load, live ? 60_000 : 10_000);
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
  const [heroMode, setHeroModeState] = useState<HeroMode>(readHeroMode);
  const setHeroMode = (m: HeroMode) => { setHeroModeState(m); saveHeroMode(m); };
  const picked = useMemo(() => pickHeroBy(sorted, me ? favs : [], heroMode), [sorted, favs, me, heroMode]);
  const hero = picked?.server ?? null;
  const heroReason: HeroReason = picked?.reason ?? null;
  // servers with a problem sit in a compact strip above the tiles (unless the hero is itself the problem: then every server is)
  // (the problem servers are named in the alert row of the pulse strip and sit first among the tiles)
  const [myOrder, setMyOrder] = useState<number[]>(readOrder);
  const orderIdx = (id: number) => { const i = myOrder.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const rest = sorted.filter((s) => s.id !== hero?.id).sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || orderIdx(a.id) - orderIdx(b.id) || Number(a.online && a.players === 0) - Number(b.online && b.players === 0) || b.players - a.players);
  // Ember: the favourites are pinned above the rest, each group with its own heading
  const pinFavs = ember && !!me && rest.some((s) => favs.includes(s.id)) && rest.some((s) => !favs.includes(s.id));
  const restShown = pinFavs ? [...rest].sort((a, b) => Number(favs.includes(b.id)) - Number(favs.includes(a.id))) : rest;
  const secHead = (i: number) => {
    if (!pinFavs) return null;
    const f = favs.includes(restShown[i].id);
    if (i === 0 && f) return <h2 className="srv-grp">{t('srv.fav.title')}</h2>;
    if (!f && (i === 0 || favs.includes(restShown[i - 1].id))) return <h2 className="srv-grp">{t('srv.fav.rest')}</h2>;
    return null;
  };
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
  // a tile is dragged onto another one: the visitor's own order of the servers (kept in this browser)
  const dragId = useRef<number | null>(null);
  const moveTile = (from: number, to: number) => {
    const ids = restShown.map((x) => x.id);
    const a = ids.indexOf(from), b = ids.indexOf(to);
    if (a < 0 || b < 0 || a === b) return;
    ids.splice(a, 1);
    ids.splice(b, 0, from);
    setMyOrder(ids);
    saveOrder(ids);
  };
  const dnd = (id: number): TileDnd | undefined => (phone || selOn || effView !== 'tiles' || effFilter !== 'all' ? undefined : {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { dragId.current = id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(id)); } catch { /* a browser without it */ } },
    onDragOver: (e: React.DragEvent) => { if (dragId.current != null && dragId.current !== id) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); const from = dragId.current; dragId.current = null; if (from != null) moveTile(from, id); },
    onDragEnd: () => { dragId.current = null; },
    // the same without a mouse: Alt and an arrow move the focused tile one place
    tabIndex: 0,
    'aria-keyshortcuts': 'Alt+ArrowLeft Alt+ArrowRight',
    'data-tile-id': id,
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (!e.altKey || e.target !== e.currentTarget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const ids = restShown.map((x) => x.id);
      const a = ids.indexOf(id);
      const b = a + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
      if (a < 0 || b < 0 || b >= ids.length) return;
      moveTile(id, ids[b]);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-tile-id="${id}"]`)?.focus());
    },
  } as TileDnd);
  const tileProps = (s: Server, idx: number) => ({
    dnd: dnd(s.id),
    rx,
    s,
    idx,
    fav: me ? favs.includes(s.id) : null,
    onFav: () => void toggleFav(s.id),
    onOpen: () => open(s),
    select,
    uptime: uptime.get(s.id),
    downSince: downSince.get(s.id),
    wide: s.id === orphan?.id ? orphan.span : 0,
  });

  const [home, setHome] = useHomeBlocks();
  // the last tile that would stand alone in its row takes two places
  const [cols, gridRef] = useGridColumns();
  const orphan = effView === 'tiles' && effFilter === 'all' && !phone ? lonelyTile(restShown.map((x) => x.id), favs, cols) : null;
  return (
    <div className="space-y-5">
      <PageHead
        title={ember && me ? greeting(me.username) : t('nav.servers')}
        subtitle={ember ? undefined : me ? `${greeting(me.username)}. ${liveLine}` : liveLine}
        icon={<IconServers />}
      >
        <span className="srv-head-actions">
          <LiveBadge at={updatedAt} onRefresh={() => void refreshNow()} busy={refreshing} />
          <HomeBlocksMenu blocks={home} onChange={setHome} heroMode={heroMode} onHeroMode={setHeroMode} />
          {isAdmin && <a className="btn btn-soft btn-sm" href="/admin/servers" data-magnetic>{t('d2.srv.manage')}</a>}
        </span>
      </PageHead>

      {loaded && servers.length > 0 && home.pulse && (
        <PulseStrip servers={servers} overview={overview} uptime={upAvg} now={overviewAt || updatedAt} onOpen={open} />
      )}


      {servers.length > 0 && (
        <div className="srv-bar" id="srv-list">
          {servers.length > 1 ? (
            <nav className="seg fade-x no-scrollbar flex w-fit max-w-full overflow-x-auto" aria-label={t('d2.srv.filter')}>
              {([
                ['all', `${t('d2.srv.f.all')} · ${servers.length}`, servers.length],
                ['online', `${t('d2.srv.f.online')} · ${online.length}`, online.length],
                ['offline', `${t('d2.srv.f.offline')} · ${offlineCount}`, offlineCount],
                ...(me ? [['fav', `${t('d2.srv.f.fav')} · ${favCount}`, favCount]] : []),
              ] as [Filter, string, number][]).filter(([id, , count]) => id !== 'offline' || count > 0 || effFilter === id).map(([id, label, count]) => (
                // an empty filter stays reachable but is dimmed, so the eye goes to the ones that have servers
                <button key={id} type="button" className={`seg-item whitespace-nowrap${count === 0 && effFilter !== id ? ' opacity-70' : ''}`} aria-pressed={effFilter === id} onClick={() => setFilter(id)}>{label}</button>
              ))}
            </nav>
          ) : <span />}
          <div className="srv-bar-tools flex items-center gap-2.5">
            {canSelect && (
              <button type="button" className="btn btn-ghost btn-sm" aria-pressed={selOn} onClick={() => (selOn ? exitSelect() : setSelecting(true))} title={t('d2.srv.selectTitle')}>
                {selOn ? t('d2.srv.cancelSelect') : t('d2.srv.select')}
              </button>
            )}
            {effView === 'tiles' && (
              <div className="seg max-sm:hidden" role="group" aria-label={t('d2.srv.tileSize')}>
                {([['s', 'S', 'd2.srv.sz.s'], ['m', 'M', 'd2.srv.sz.m'], ['l', 'L', 'd2.srv.sz.l']] as const).map(([id, mark, label]) => (
                  <button key={id} type="button" className="seg-item" aria-pressed={size === id} title={t(label)} aria-label={t(label)} onClick={() => setSize(id)}><span className="sz-mark" data-sz={id} aria-hidden>{mark}<i /><i /><i /><i /></span></button>
                ))}
              </div>
            )}
            <div className="seg" role="group" aria-label={t('d2.news.viewLabel')}>
              {([['tiles', 'd2.srv.v.tiles'], ['list', 'd2.news.viewList'], ['chart', 'd2.srv.v.chart']] as [ServersView, TKey][]).map(([id, label]) => (
                <button key={id} type="button" className="seg-item srv-view-btn" aria-pressed={effView === id} title={t(label)} onClick={() => setView(id)}>
                  <ViewIcon id={id} /><span className="max-sm:sr-only">{t(label)}</span>
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
              <div className="fade-in srv-grid" data-size={size} ref={gridRef}>
                {hero && <HeroTile key={hero.id} {...tileProps(hero, 0)} reason={heroReason} />}
                {restShown.map((s, i) => <Fragment key={s.id}>{secHead(i)}<Tile {...tileProps(s, i + 1)} /></Fragment>)}
              </div>
            )}
          </div>
          {home.news && <WhatsNew open={wnOpen} onToggle={toggleWn} overview={overview} />}
        </div>
      )}

      <ScrollTop />
      {pull > 0 && <div className="srv-pull" style={{ height: pull }} aria-hidden>{pull >= PULL_AT ? t('d2.srv.pullRelease') : t('d2.srv.pull')}</div>}

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
