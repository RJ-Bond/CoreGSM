import ServerReviews from '../components/server/Reviews';
import ProbesView, { useProbes } from '../components/server/ProbesView';
import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { t, useI18n } from '../i18n';
import { Crumbs } from '../components/ShellExtras';
import { normalizeKinds, useSubscriptions, type SubKind } from '../notifications';
import { api, ApiError, type ServerDetails as BaseDetails } from '../api';
import { useAuth } from '../auth';
import { gameGradient, gameLabel } from '../games';
import { coverBackground, coverUrlOf, emblemStyle, gameBackdrop } from '../cover';
import { applyConnectTemplates, connectGuide } from '../connectGuides';
import { useGameProfiles } from '../gameProfiles';
import { Burst, CopyButton, ErrorLine, GameAvatar, IconBell, LoadError, IconCheckMark, IconRefresh, IconShare, StatusPill, ago, isLag, toast, useDepth, useFlashOnChange, usePoll, navigate, errText } from '../ui';
import NotFound from '../components/NotFound';
import { confirmDialog } from '../confirm';
import ServerForm from './ServerForm';
import HistoryChart, { type Series } from '../components/server/HistoryChart';
import PlayersList, { PlayerFacts, SessionSpread } from '../components/server/PlayersList';
import EventsFeed from '../components/server/EventsFeed';
import ConnectTab from '../components/server/ConnectTab';
import SubscribeMenu from '../components/server/SubscribeMenu';
import Passport from '../components/server/Passport';
import Hero, { type FreeSlotState } from '../components/server/Hero';
import Metrics from '../components/server/Metrics';
import OfflineState from '../components/server/OfflineState';
import PinnedNotice, { type ServerNotice } from '../components/server/Notice';
import MoreMenu, { type MoreItem } from '../components/server/MoreMenu';
import { gameAccent, isFullNow, offlineSince } from '../components/server/serverLogic';
import { calmSeriesColor, useCoverAccent } from '../components/server/coverAccent';
import ServerTabs, { TAB_LIST, panelDomId, tabDomId } from '../components/server/ServerTabs';
import { AddrCopy } from '../components/servers/serverUi';
import { BlockBoundary, SectionCard, useSectionState, type SectionDef } from '../components/server/Sections';
import { BannerSkeleton, TabBarSkeleton, TabSkeleton } from '../components/server/Skeletons';
import {
  SERVER_TABS, countryName, flagEmoji, guessMode, stagger, tabHref, useNow, type TabId,
} from '../components/server/helpers';
import { lazyPage, PageFrame } from '../lazyPage';

// the analytics tab and its charts load when it is opened
const AnalyticsTab = lazyPage(() => import('../components/server/AnalyticsTab'));

export { SERVER_TABS } from '../components/server/helpers';

/** details + the additive fields: when the server was added and (admins only) its Discord message */
type ServerDetails = BaseDetails & {
  createdAt?: number | null;
  notice?: ServerNotice | null;
  discord?: { channelId: string; channelName: string | null; guildName: string | null; guildId: string | null; messageId: string | null; enabled: boolean }[];
};

// foldable blocks of the long tabs (ids are shared with the fold memory in localStorage, so keep them stable)
const OVERVIEW_SECTIONS: SectionDef[] = [
  { id: 'ov-stats', label: 'Показатели' },
  { id: 'ov-chart', label: 'График' },
  { id: 'ov-events', label: 'События', secondary: true },
  { id: 'ov-players', label: 'Игроки' },
  { id: 'ov-probes', label: 'Доступность', secondary: true },
  { id: 'ov-reviews', label: 'Отзывы', secondary: true },
];
const HISTORY_SECTIONS: SectionDef[] = [
  { id: 'hi-chart', label: 'График' },
  { id: 'hi-stats', label: 'Показатели', secondary: true },
];
export const CONNECT_SECTIONS: SectionDef[] = [
  { id: 'cn-steps', label: 'Как подключиться' },
  { id: 'cn-qr', label: 'QR-код' },
];
const ALL_SECTIONS = [...OVERVIEW_SECTIONS, ...HISTORY_SECTIONS, ...CONNECT_SECTIONS];

/** key={id}: switching between servers starts from a clean state */
export default function ServerDetail({ id, tab = '' }: { id: number; tab?: string }) {
  return <ServerDetailView key={id} id={id} tab={tab as TabId} />;
}

/** a small "live" indicator: pulsing dot and how fresh the data is */
function LiveBadge({ at }: { at: number | null }) {
  useNow(5000);
  if (!at) return null;
  return (
    <span className="chip-glass srv-live" title={`Страница обновляется сама · обновлено ${ago(at)}`}>
      <span className="live-dot" aria-hidden />
      <span className="srv-live-t">обновлено {ago(at)}</span>
    </span>
  );
}

function FavStar({ on, name, onClick }: { on: boolean; name: string; onClick: () => void }) {
  // pops only after the user's own click
  const [pops, setPops] = useState(0);
  return (
    <button
      type="button"
      onClick={() => { if (!on) { setPops((n) => n + 1); try { navigator.vibrate?.(14); } catch { /* no vibration */ } } onClick(); }}
      className={`btn-icon-glass shrink-0 ${on ? 'is-fav' : ''}`}
      title={on ? 'Убрать из избранного' : 'В избранное'}
      aria-label={`${on ? 'Убрать из избранного' : 'В избранное'}: ${name}`}
      aria-pressed={on}
    >
      <span className="star-wrap text-xl leading-none">
        <span key={on ? pops : 'off'} className={on && pops > 0 ? 'star-pop' : ''} aria-hidden>{on ? '★' : '☆'}</span>
        {on && pops > 0 && <Burst key={pops} count={6} radius={15} />}
      </span>
    </button>
  );
}

function PeriodSeg({ hours, onChange }: { hours: number; onChange: (h: number) => void }) {
  return (
    <div className="seg" role="group" aria-label={t('srv.chart.period')}>
      {([[24, '24 ч'], [168, '7 дн'], [720, '30 дн']] as [number, string][]).map(([h, label]) => (
        <button key={h} type="button" onClick={() => onChange(h)} aria-pressed={hours === h} className="seg-item">{label}</button>
      ))}
    </div>
  );
}

/** on a phone a swipe along the page moves to the next / previous tab; charts, scrollable blocks and the screen edges are left alone */
function useTabSwipe(tab: TabId, id: number) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const scrollsX = (el: HTMLElement | null) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.scrollWidth > n.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true;
    }
    return false;
  };
  return {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      const p = e.touches[0];
      const el = e.target as HTMLElement;
      const edge = p.clientX < 24 || p.clientX > window.innerWidth - 24;
      start.current = edge || el.closest('svg, canvas, input, select, textarea, [role="slider"], [data-noswipe]') || scrollsX(el) ? null : { x: p.clientX, y: p.clientY, at: Date.now() };
    },
    onTouchEnd: (e: TouchEvent<HTMLElement>) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - s.x;
      const dy = p.clientY - s.y;
      if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.5 || Date.now() - s.at > 600) return;
      const i = TAB_LIST.findIndex((x) => x.id === tab);
      const n = dx < 0 ? i + 1 : i - 1;
      if (n >= 0 && n < TAB_LIST.length) navigate(tabHref(id, TAB_LIST[n].id));
    },
  };
}

// what the user picked last time: the chart period and series, and the tab of every server
const PREFS_KEY = 'coregsm_srv_prefs';
const TABS_KEY = 'coregsm_srv_tabs';
function readPrefs(): { hours: number; series: Series } {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as { hours?: number; series?: string } | null;
    return { hours: v && [24, 168, 720].includes(v.hours as number) ? (v.hours as number) : 24, series: v?.series === 'ping' ? 'ping' : 'players' };
  } catch {
    return { hours: 24, series: 'players' };
  }
}
function readTabs(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(TABS_KEY) ?? 'null') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function ServerDetailView({ id, tab }: { id: number; tab: TabId }) {
  useI18n();
  const swipe = useTabSwipe(tab, id);
  const nowTs = useNow(30_000);
  const { me, isAdmin } = useAuth();
  // editing a server: administrators and moderators given «Серверы»
  const canEdit = isAdmin || !!me?.perms?.includes('servers');
  const probes = useProbes(id);
  // the phone bar shows once the banner's buttons are scrolled out of sight
  const actionsRef = useRef<HTMLDivElement>(null);
  const [barOn, setBarOn] = useState(false);
  useEffect(() => {
    const el = actionsRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setBarOn(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  });
  const [prefs] = useState(readPrefs);
  const [hours, setHours] = useState(prefs.hours);
  const [series, setSeries] = useState<Series>(prefs.series);
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ hours, series })); } catch { /* private mode */ }
  }, [hours, series]);
  const [data, setData] = useState<ServerDetails | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [favs, setFavs] = useState<number[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const sections = useSectionState(ALL_SECTIONS);
  const seq = useRef(0);
  const firstHours = useRef(true);
  const prevNames = useRef<Set<string> | null>(null);
  const freshTimer = useRef(0);

  // only the newest request may update the page; ONE request feeds every tab
  const load = (h = hours) => {
    const n = ++seq.current;
    return api<ServerDetails>(`/servers/${id}/details?hours=${h}`)
      .then((d) => {
        if (n !== seq.current) return;
        // players that were not in the previous poll get a short highlight (never on the first load)
        const names = new Set((d.playersNow ?? []).map((p) => p.name));
        const prev = prevNames.current;
        if (prev) {
          const added = [...names].filter((x) => !prev.has(x));
          if (added.length) {
            setFresh(new Set(added));
            window.clearTimeout(freshTimer.current);
            freshTimer.current = window.setTimeout(() => setFresh(new Set()), 4500);
          }
        }
        prevNames.current = names;
        setData(d);
        setError('');
        setMissing(false);
      })
      .catch((e: Error) => {
        if (n !== seq.current) return;
        if (e instanceof ApiError && e.status === 404) setMissing(true);
        else setError(e.message);
      });
  };
  usePoll(() => { void load(); }, 15_000);
  useEffect(() => {
    // the first load is done by usePoll
    if (firstHours.current) { firstHours.current = false; return; }
    void load(hours);
  }, [hours]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(freshTimer.current), []);

  useEffect(() => {
    if (!me) { setFavs(null); return; }
    api<number[]>('/favorites').then(setFavs).catch(() => setFavs([]));
  }, [me]);
  const isFav = !!favs?.includes(id);
  const toggleFav = async () => {
    const cur = favs ?? [];
    const on = cur.includes(id);
    setFavs(on ? cur.filter((x) => x !== id) : [...cur, id]);
    await api(`/favorites/${id}`, on ? 'DELETE' : 'PUT').catch(() => undefined);
  };

  const subs = useSubscriptions(!!me);
  const [subOpen, setSubOpen] = useState(false);
  const [subPre, setSubPre] = useState<SubKind | null>(null);
  const openSub = (kind: SubKind | null = null) => { setSubPre(kind); setSubOpen(true); };
  const profiles = useGameProfiles();
  const depth = useDepth<HTMLElement>();
  const [shared, setShared] = useState(false);
  // red ring once when the server goes online -> offline while this page is open
  const wentOffline = useFlashOnChange(data ? data.server.online || !data.server.hasStatus : true, (prev, next) => prev && !next);

  // switching tabs: when the page was scrolled past the tab bar, show the top of the new content instead of the middle of it
  const firstTab = useRef(true);
  useEffect(() => {
    if (firstTab.current) { firstTab.current = false; return; }
    const bar = document.querySelector<HTMLElement>('.srv-tabbar');
    const marker = bar?.previousElementSibling as HTMLElement | null;
    if (!bar || !marker) return;
    const offset = parseFloat(bar.style.top || '0');
    const target = marker.getBoundingClientRect().top + window.scrollY - offset;
    if (window.scrollY > target) window.scrollTo(0, Math.max(0, target));
  }, [tab]);

  // the cover moves slower than the page: a few pixels of parallax (not with reduced motion)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce') return;
    let raf = 0;
    const tick = () => {
      raf = 0;
      document.querySelector<HTMLElement>('.srv-banner')?.style.setProperty('--par', String(Math.min(36, Math.max(0, Math.round(window.scrollY * 0.22)))));
    };
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(tick); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (raf) window.cancelAnimationFrame(raf); };
  }, []);

  // once, on a touch screen: a hint that the tabs can be swiped
  const [swipeHint, setSwipeHint] = useState(false);
  useEffect(() => {
    let seen = true;
    try { seen = localStorage.getItem('coregsm_swipe_hint') === '1'; } catch { /* private mode */ }
    if (seen || !window.matchMedia?.('(pointer: coarse)').matches) return;
    const on = window.setTimeout(() => setSwipeHint(true), 1800);
    const off = window.setTimeout(() => { setSwipeHint(false); try { localStorage.setItem('coregsm_swipe_hint', '1'); } catch { /* private mode */ } }, 7500);
    return () => { window.clearTimeout(on); window.clearTimeout(off); };
  }, []);
  useEffect(() => {
    if (!swipeHint) return;
    setSwipeHint(false);
    try { localStorage.setItem('coregsm_swipe_hint', '1'); } catch { /* private mode */ }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // the tab is remembered per server: «/servers/5» reopens the tab the user left it on (the overview is a choice too)
  const tabSeen = useRef(false);
  useEffect(() => {
    const m = readTabs();
    if (!tabSeen.current) {
      tabSeen.current = true;
      const last = m[String(id)] as TabId | undefined;
      if (!tab && last && (SERVER_TABS as readonly string[]).includes(last)) { navigate(tabHref(id, last), { replace: true }); return; }
    }
    m[String(id)] = tab;
    try { localStorage.setItem(TABS_KEY, JSON.stringify(m)); } catch { /* private mode */ }
  }, [tab, id]);

  // which way the tab bar moved: the new panel slides in from that side
  const tabIdx = TAB_LIST.findIndex((x) => x.id === tab);
  const [slide, setSlide] = useState({ idx: tabIdx, dir: '' });
  if (slide.idx !== tabIdx) setSlide({ idx: tabIdx, dir: tabIdx > slide.idx ? 'r' : 'l' });

  // the colour of the page: from the server's cover when it has one, else the game's (a hook: before any return)
  const coverAccentOrGame = useCoverAccent(data ? coverUrlOf(data.server.coverUrl, data.server.game) : null, data ? gameAccent(data.server.game) : 'rgb(var(--brand))');

  if (missing) return <NotFound kind="server" />;

  const back = <Crumbs items={[['/servers', t('nav.servers')], [`/servers/${id}`, data?.server.name ?? '…']]} />;

  if (!data) {
    return (
      <div className="space-y-3.5" aria-busy={error ? undefined : true} aria-label={error ? undefined : 'Загрузка'}>
        {back}
        {error ? <LoadError error={error} onRetry={() => void load()} /> : (
          <>
            <BannerSkeleton />
            <TabBarSkeleton />
            <TabSkeleton tab={tab} />
          </>
        )}
      </div>
    );
  }

  const { server: s, stats, events, points } = data;
  const accent = coverAccentOrGame;
  const [c1, c2] = gameGradient(s.game);
  const lag = isLag(s);
  const profile = profiles?.[s.game];
  const guide = applyConnectTemplates(connectGuide(s.game, s.address), profile?.connect, s.address, profile?.defaultPort);
  // placeholder versions such as 0.0.0.1 say nothing
  const realVersion = s.version && !/^0(\.0)*(\.\d+)?$/.test(s.version.trim()) ? s.version.trim() : null;
  const mode = guessMode(s.name);
  const code = (s.countryCode || s.country || '').toUpperCase();
  const cName = countryName(code);
  const flag = flagEmoji(code);
  const kind = !s.hasStatus ? 'mute' : !s.online ? 'bad' : lag ? 'warn' : 'ok';
  const windowLabel = data.hours <= 24 ? 'за 24 часа' : data.hours <= 168 ? 'за 7 дней' : 'за 30 дней';
  const chartLoading = data.hours !== hours;
  const recent = points.filter((p) => p.online && p.ts >= nowTs - 2 * 3600_000).map((p) => p.players);
  const hourNow = new Date(nowTs).getHours();
  const tod = hourNow >= 5 && hourNow < 10 ? 'morning' : hourNow >= 17 && hourNow < 21 ? 'dusk' : hourNow >= 21 || hourNow < 5 ? 'night' : 'day';
  const coverBg = coverBackground(s.coverUrl, gameBackdrop(c1, 120), { strong: true, game: s.game });

  const discordLinks = (data.discord ?? []).map((b) => {
    const text = `${b.guildName ? `${b.guildName} · ` : ''}${b.channelName ? `#${b.channelName}` : 'канал'}${b.messageId ? ' · сообщение' : ''}`;
    const href = b.guildId ? `https://discord.com/channels/${b.guildId}/${b.channelId}${b.messageId ? `/${b.messageId}` : ''}` : null;
    return { text, href };
  });

  const refresh = async () => {
    setBusy(true);
    await api(`/servers/${id}/refresh`, 'POST').catch((e: Error) => setError(e.message));
    await load();
    setBusy(false);
  };
  const share = async () => {
    const url = `${window.location.origin}/s/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Ссылка скопирована');
      setShared(true);
      window.setTimeout(() => setShared(false), 1500);
    } catch {
      toast(`Не удалось скопировать. Ссылка: ${url}`, 'err', 8000);
    }
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: `Удалить сервер «${s.name}»?`, text: 'Сервер будет удалён вместе с привязками к Discord.', confirmLabel: 'Удалить', danger: true });
    if (!ok) return;
    try {
      await api(`/servers/${id}`, 'DELETE');
      toast('Сервер удалён');
      navigate('/servers');
    } catch (e) {
      setError(errText(e));
    }
  };
  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(s.address);
      toast('Адрес скопирован');
    } catch {
      toast(`Адрес: ${s.address}`, 'info', 8000);
    }
  };

  // a server that is down: instead of a chart of zeros, since when and why plus the availability strip
  const down = !s.online && s.hasStatus;
  const outage = down ? offlineSince(events, points) : null;
  const chartEl = (withSeries: boolean) => (
    <HistoryChart points={points} hours={data.hours} events={events} title={s.name} game={gameLabel(s.game)} max={s.maxPlayers} color={series === 'ping' ? 'rgb(var(--link))' : calmSeriesColor(accent)} series={withSeries ? series : 'players'} loading={chartLoading} baseline={data.baseline ?? null} />
  );
  const chartTile = (i: number, withSeries: boolean) => (
    <SectionCard
      id={withSeries ? 'hi-chart' : 'ov-chart'}
      state={sections}
      className="lg:col-span-12"
      style={stagger(i)}
      title={withSeries ? (series === 'ping' ? t('srv.chart.titlePing') : t('srv.chart.titlePlayers')) : t('srv.chart.titlePlayers')}
    >
      <div className="srv-chart-bar">
        {withSeries && (
          <div className="seg" role="group" aria-label={t('srv.chart.series')}>
            {([['players', 'Игроки'], ['ping', 'Пинг']] as [Series, string][]).map(([k, label]) => (
              <button key={k} type="button" className="seg-item" aria-pressed={series === k} onClick={() => setSeries(k)}>{label}</button>
            ))}
          </div>
        )}
        <PeriodSeg hours={hours} onChange={setHours} />
      </div>
      {stats.samples < 2 ? (
        <p className="py-10 text-center font-semibold text-mute">Данных пока мало: график появится через несколько минут после добавления сервера.</p>
      ) : down ? (
        <OfflineState since={outage?.ts ?? null} atLeast={outage?.atLeast ?? false} error={s.error ?? null} points={points} hours={data.hours} now={nowTs} uptimePct={stats.uptimePct ?? null} windowLabel={windowLabel}>
          {chartEl(withSeries)}
        </OfflineState>
      ) : chartEl(withSeries)}
      {!down && points.some((p) => !p.online) && stats.samples >= 2 && (
        <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-mute"><span className="inline-block h-3 w-3 rounded-sm bg-bad/30" /> Красным отмечены периоды, когда сервер не отвечал.</p>
      )}
    </SectionCard>
  );

  const metrics = (withSamples: boolean) => (
    <Metrics
      withSamples={withSamples}
      d={{
        online: s.online, hasStatus: s.hasStatus, players: s.players, maxPlayers: s.maxPlayers,
        peak: stats.peakPlayers ?? null, peakAt: stats.peakAt ?? null, uptimePct: stats.uptimePct ?? null, avg: stats.avgPlayers ?? null,
        samples: stats.samples, windowLabel,
        series: points.filter((p) => p.online).map((p) => p.players),
      }}
    />
  );

  const playersProps = { online: s.online, players: s.players, names: s.playerNames, list: data.playersNow ?? [], fresh };
  const playerCountBadge = s.online ? <span className="ml-2 inline-block shrink-0 whitespace-nowrap rounded-full bg-soft px-2.5 py-0.5 text-center text-xs font-extrabold tabular-nums leading-5 text-link">{s.players}</span> : null;

  const canSubNow = !!me && !subs.unavailable && subs.list !== null;
  let panel: ReactNode;
  if (tab === 'players') {
    panel = (
      <section className="tile tile-in p-4 sm:p-5">
        <h2 className="mb-3 flex items-center whitespace-nowrap text-base font-extrabold">Сейчас в игре{playerCountBadge}</h2>
        {s.online && <PlayerFacts peak={stats.peakPlayers ?? null} peakAt={stats.peakAt ?? null} avg={stats.avgPlayers ?? null} windowLabel={windowLabel} list={data.playersNow ?? []} />}
        {s.online && <SessionSpread list={data.playersNow ?? []} now={nowTs} />}
        <PlayersList {...playersProps} onSubscribe={canSubNow ? () => openSub(null) : undefined} />
      </section>
    );
  } else if (tab === 'history') {
    panel = (
      <div className="space-y-3.5">
        <div className="grid gap-3.5 lg:grid-cols-12">
          {chartTile(0, true)}
        </div>
        <SectionCard id="hi-stats" state={sections} title="Показатели">
          {metrics(true)}
        </SectionCard>
      </div>
    );
  } else if (tab === 'stats') {
    panel = <PageFrame><AnalyticsTab id={id} /></PageFrame>;
  } else if (tab === 'events') {
    panel = (
      <section className="tile tile-in p-4 sm:p-5">
        <h2 className="mb-3 text-base font-extrabold">Журнал событий</h2>
        <EventsFeed events={events} online={s.online} uptimePct={stats.uptimePct ?? null} windowLabel={windowLabel} />
      </section>
    );
  } else if (tab === 'connect') {
    panel = <ConnectTab game={s.game} address={s.address} sections={sections} />;
  } else {
    panel = (
      <div className="space-y-3.5">
        <PinnedNotice serverId={id} notice={data.notice ?? null} canEdit={canEdit} onChange={(n) => setData((d) => (d ? { ...d, notice: n } : d))} />
        <SectionCard id="ov-stats" state={sections} style={stagger(0)} title="Показатели">
          {metrics(false)}
        </SectionCard>
        <div className="grid gap-3.5 lg:grid-cols-12">
          {chartTile(1, false)}
          <div className="space-y-3.5 lg:col-span-5 lg:col-start-1 lg:self-start max-lg:contents">
          <SectionCard id="ov-events" state={sections} className="max-lg:order-1" style={stagger(2)} title="Последние события">
            <EventsFeed events={events} online={s.online} limit={6} moreHref={tabHref(id, 'events')} />
          </SectionCard>
          {/* the reviews sit under the events: the left column fills the height of the player list */}
          <SectionCard id="ov-reviews" state={sections} className="max-lg:order-3" style={stagger(4)} title="Отзывы игроков">
            <ServerReviews serverId={id} />
          </SectionCard>
          </div>
          <SectionCard id="ov-players" state={sections} className="lg:col-span-7 lg:col-start-6 lg:row-span-2 max-lg:order-2" style={stagger(3)} title={<span className="inline-flex items-center whitespace-nowrap">Сейчас в игре{playerCountBadge}</span>}>
            <PlayersList {...playersProps} limit={6} moreHref={tabHref(id, 'players')} />
          </SectionCard>
        </div>
        {probes && probes.probes.length > 0 && (
          <SectionCard id="ov-probes" state={sections} style={stagger(4)} title="Доступность из разных мест">
            <ProbesView v={probes} />
          </SectionCard>
        )}
      </div>
    );
  }

  // subscriptions: one dialog for the header button, the free-slot button and the phone bar
  const subscribedKinds = normalizeKinds(subs.list?.find((x) => x.serverId === id)?.kinds);
  const canSub = !!me && !subs.unavailable && subs.list !== null;
  const full = isFullNow(s.online, s.players, s.maxPlayers);
  const freeSlot: FreeSlotState = !full ? 'hidden' : !me ? 'guest' : !canSub ? 'hidden' : subscribedKinds.includes('free_slot') ? 'subscribed' : 'ready';
  const subLabel = subscribedKinds.length > 0 ? t('sub.buttonOn') : t('sub.button');

  const connectHref = guide.link?.href ?? tabHref(id, 'connect');
  const copyInstead = tab === 'connect' && !guide.link;
  const onConnect = copyInstead ? (e: { preventDefault: () => void }) => { e.preventDefault(); void copyAddress(); } : undefined;
  const connectLabel = copyInstead ? t('srv.act.copyForJoin') : t('srv.act.connect');

  const moreItems: MoreItem[] = [
    { key: 'share', label: shared ? t('srv.act.linkCopied') : t('srv.act.share'), icon: shared ? <IconCheckMark /> : <IconShare />, onSelect: () => void share() },
    ...(canEdit ? [
      { key: 'poll', label: busy ? 'Опрос…' : 'Опросить', icon: <IconRefresh />, onSelect: () => void refresh(), disabled: busy, divider: true },
      { key: 'edit', label: 'Изменить', onSelect: () => setEditing(true) },
    ] : []),
    ...(isAdmin ? [{ key: 'del', label: 'Удалить', onSelect: () => void remove(), danger: true }] : []),
  ];

  return (
    <div className="srv-page space-y-3.5" style={{ ['--srv-accent' as string]: accent }}>
      {back}

      {/* from lg up: the banner is a column on the left (it stays in view), the tabs and the content are on the right */}
      <div className="srv-shell">
      <article
        className={`${emblemStyle(s.coverUrl, s.game).className ? 'emblem-host' : ''} srv-banner srv-glow srv-${kind} depth relative rounded-ui-xl p-4 text-white sm:p-6`}
        style={emblemStyle(s.coverUrl, s.game).style}
        {...depth}
      >
        {emblemStyle(s.coverUrl, s.game).className && <span aria-hidden className="emblem-layer" />}
        {/* decoration is clipped by its own box, so the «Ещё» popover below is free to leave the banner */}
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-ui-xl">
          <span className="srv-cover" style={{ background: coverBg }} />
          <span className="srv-tod" data-tod={tod} />
          <span className="depth-l1 absolute -right-14 -top-20 h-64 w-64 rounded-full bg-white/15" />
          <span className="depth-l2 absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-black/10" />
        </span>
        {/* a soft dark scrim: the text stays readable over any cover picture */}
        <span aria-hidden className="srv-scrim pointer-events-none absolute inset-0 rounded-ui-xl" />
        {wentOffline && <span className="flash-ring" aria-hidden />}

        {/* title row: name, status, game */}
        <div className="srv-title relative flex items-start gap-3.5 sm:gap-4">
          <span className="srv-ico"><GameAvatar game={s.game} size={72} glass vtId={s.id} /></span>
          <div className="min-w-0 flex-1">
            <h1 className="wrap-break-word text-[22px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[28px]">{s.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <StatusPill glass online={s.online} known={s.hasStatus} lag={lag} maintenance={!!s.maintenance} />
              <span className="chip-glass">{gameLabel(s.game)}</span>
              <LiveBadge at={s.updatedAt} />
              {isFav && <span className="chip-glass"><span aria-hidden>★</span> В избранном</span>}
            </div>
          </div>
          {me && <FavStar on={isFav} name={s.name} onClick={() => void toggleFav()} />}
        </div>

        <Hero
          online={s.online}
          hasStatus={s.hasStatus}
          players={s.players}
          max={s.maxPlayers}
          maintenance={s.maintenance}
          freeSlot={freeSlot}
          onNotify={() => openSub('free_slot')}
          who={(data.playersNow?.length ? data.playersNow.map((p) => ({ name: p.name, since: p.since as number | null })) : s.playerNames.map((n) => ({ name: n, since: null }))).filter((w) => w.name)}
          whoHref={tabHref(id, 'players')}
          peak={stats.peakPlayers ?? null}
          recent={recent}
          now={nowTs}
          lastSeen={s.updatedAt}
        />

        <Passport
          d={{
            game: gameLabel(s.game),
            version: realVersion,
            flag,
            country: cName,
            map: s.map,
            address: s.address,
            ping: s.ping,
            online: s.online,
            createdAt: data.createdAt ?? null,
            lastSeen: s.updatedAt,
            mode,
            discord: discordLinks,
          }}
        />

        {!s.online && s.error && !s.hasStatus && (
          <p className="relative mt-3.5 rounded-2xl bg-black/25 px-4 py-2.5 text-sm font-bold">{s.error}</p>
        )}

        {/* one main button; copy and subscribe are equal glass ones; the rest lives in «Ещё».
            On phones «Подключиться» takes the whole first row; once these buttons scroll away a small bar with it
            (and «Подписаться») floats above the bottom navigation. */}
        <div ref={actionsRef} className="srv-actions relative mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:flex-wrap sm:items-center">
          <a className="btn-cta srv-cta max-sm:col-span-2" href={connectHref} onClick={onConnect}>
            <span>{connectLabel}</span>
            <small className="srv-cta-addr">{s.address}</small>
          </a>
          <CopyButton text={s.address} label={t('srv.cn.copy')} tone="glass" className="srv-addr-btn" />
          <div className="srv-act-group">
            {/* hidden on phones by a wrapper: the glass button's own CSS would win over a hidden utility on the button itself */}
            {canSub && (
              <span className="contents max-sm:hidden">
                <button type="button" className="btn-glass" onClick={() => openSub(null)} aria-haspopup="dialog" aria-label={`${subLabel}: ${s.name}`}>
                  <IconBell size={18} />
                  {subLabel}
                </button>
              </span>
            )}
            <MoreMenu items={moreItems} />
          </div>
        </div>
      </article>

      <div className="srv-main min-w-0 space-y-3.5">
      <ErrorLine text={error} />

      <ServerTabs
        id={id}
        tab={tab}
        counts={{ events: events.length, players: s.online ? s.players : 0 }}
        mini={(
          <span className="srv-mini">
            <i className={`srv-mini-dot ${s.online ? 'on' : 'off'}`} aria-hidden />
            <b className="truncate">{s.name}</b>
            <span className="tabular-nums">{s.online ? `${s.players}${s.maxPlayers ? ` / ${s.maxPlayers}` : ''}` : 'не в сети'}</span>
            <AddrCopy address={s.address} className="truncate font-mono text-xs font-semibold" />
          </span>
        )}
      />

      {swipeHint && <p className="srv-swipe-hint" role="status">← Смахните вбок, чтобы переключить вкладку →</p>}

      <div key={tab || 'overview'} className={slide.dir ? `tab-slide-${slide.dir}` : undefined} role="tabpanel" id={panelDomId(tab)} aria-labelledby={tabDomId(tab)} {...swipe}>
        <BlockBoundary label={tab || 'overview'}>{panel}</BlockBoundary>
      </div>
      </div>
      </div>

      {me && (
        <SubscribeMenu serverId={id} serverName={s.name} subs={subs} open={subOpen} onOpenChange={setSubOpen} preselect={subPre} hideButton />
      )}

      <div className={`srv-mbar ${barOn ? 'is-on' : ''}`} role="region" aria-label={t('srv.bar.label')} aria-hidden={!barOn}>
        <a className="btn" href={connectHref} onClick={onConnect} tabIndex={barOn ? undefined : -1}>{connectLabel}</a>
        {canSub && (
          <button type="button" className="btn btn-soft" tabIndex={barOn ? undefined : -1} onClick={() => openSub(null)} aria-haspopup="dialog" aria-label={`${subLabel}: ${s.name}`}>
            <IconBell size={18} />
            {subLabel}
          </button>
        )}
      </div>

      {editing && (
        <ServerForm
          initial={{ name: s.customName, game: s.game, host: s.host, port: s.port, queryPort: s.queryPort, displayAddress: s.displayAddress, country: s.country }}
          id={s.id}
          coverUrl={s.coverUrl}
          onCoverChanged={() => void load()}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void load(); }}
        />
      )}
    </div>
  );
}
