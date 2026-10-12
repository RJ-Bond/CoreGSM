import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type ServerDetails } from '../api';
import { useAuth } from '../auth';
import { gameColor, gameGradient, gameLabel } from '../games';
import { coverBackground } from '../cover';
import { connectGuide } from '../connectGuides';
import { AnimatedNumber, Burst, CopyButton, ErrorLine, GameAvatar, IconCheckMark, IconRefresh, IconShare, StatusPill, ago, fmtDateTime, isLag, plural, toast, useDepth, useFlashOnChange, usePoll } from '../ui';
import NotFound from '../components/NotFound';
import { confirmDialog } from '../confirm';
import ServerForm from './ServerForm';
import HistoryChart, { type Series } from '../components/server/HistoryChart';
import PlayersList from '../components/server/PlayersList';
import EventsFeed from '../components/server/EventsFeed';
import ConnectTab from '../components/server/ConnectTab';
import ServerTabs, { panelDomId, tabDomId } from '../components/server/ServerTabs';
import { BannerSkeleton, TabBarSkeleton, TabSkeleton } from '../components/server/Skeletons';
import {
  TONE_TEXT, countryName, flagEmoji, guessMode, loadTone, pingTone, stagger, tabHref, useNow, type TabId,
} from '../components/server/helpers';

export { SERVER_TABS } from '../components/server/helpers';

/** key={id}: switching between servers starts from a clean state */
export default function ServerDetail({ id, tab = '' }: { id: number; tab?: string }) {
  return <ServerDetailView key={id} id={id} tab={tab as TabId} />;
}

/** a small "live" indicator: pulsing dot and how fresh the data is */
function LiveBadge({ at }: { at: number | null }) {
  useNow(5000);
  if (!at) return null;
  return (
    <span className="chip-glass" title="Страница обновляется сама">
      <span className="live-dot" aria-hidden />
      обновлено {ago(at)}
    </span>
  );
}

function FavStar({ on, name, onClick }: { on: boolean; name: string; onClick: () => void }) {
  // pops only after the user's own click
  const [pops, setPops] = useState(0);
  return (
    <button
      type="button"
      onClick={() => { if (!on) setPops((n) => n + 1); onClick(); }}
      className="btn-glass !h-11 !w-11 shrink-0 !px-0 text-xl leading-none"
      title={on ? 'Убрать из избранного' : 'В избранное'}
      aria-label={`${on ? 'Убрать из избранного' : 'В избранное'}: ${name}`}
      aria-pressed={on}
    >
      <span className="star-wrap">
        <span key={on ? pops : 'off'} className={on && pops > 0 ? 'star-pop' : ''} aria-hidden>{on ? '★' : '☆'}</span>
        {on && pops > 0 && <Burst key={pops} count={6} radius={15} />}
      </span>
    </button>
  );
}

function StatTile({ k, hint, i, children }: { k: string; hint?: ReactNode; i: number; children: ReactNode }) {
  return (
    <div className="tile tile-in p-4 sm:p-[18px]" style={stagger(i)}>
      <div className="stat-k">{k}</div>
      <div className={`stat-v mt-1 ${typeof children === 'string' ? 'truncate' : ''}`}>{children}</div>
      {hint && <div className="stat-s mt-0.5 truncate">{hint}</div>}
    </div>
  );
}

function PeriodSeg({ hours, onChange }: { hours: number; onChange: (h: number) => void }) {
  return (
    <div className="seg" role="group" aria-label="Период">
      {([[24, '24 ч'], [168, '7 дн']] as [number, string][]).map(([h, label]) => (
        <button key={h} type="button" onClick={() => onChange(h)} aria-pressed={hours === h} className="seg-item">{label}</button>
      ))}
    </div>
  );
}

function ServerDetailView({ id, tab }: { id: number; tab: TabId }) {
  const { me, isAdmin } = useAuth();
  const [hours, setHours] = useState(24);
  const [series, setSeries] = useState<Series>('players');
  const [data, setData] = useState<ServerDetails | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [favs, setFavs] = useState<number[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
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

  if (missing) return <NotFound kind="server" />;

  const back = <a href="#/servers" className="ml-1 inline-flex min-h-[44px] items-center gap-1 font-extrabold text-link hover:underline md:min-h-0">← Все серверы</a>;

  if (!data) {
    return (
      <div className="space-y-3.5" aria-busy="true" aria-label="Загрузка">
        {back}
        <BannerSkeleton />
        <TabBarSkeleton />
        <TabSkeleton tab={tab} />
        <ErrorLine text={error} />
      </div>
    );
  }

  const { server: s, stats, events, points } = data;
  const color = gameColor(s.game);
  const [c1, c2] = gameGradient(s.game);
  const lag = isLag(s);
  const guide = connectGuide(s.game, s.address);
  // placeholder versions such as 0.0.0.1 say nothing
  const realVersion = s.version && !/^0(\.0)*(\.\d+)?$/.test(s.version.trim()) ? s.version.trim() : null;
  const mode = guessMode(s.name);
  const code = (s.countryCode || s.country || '').toUpperCase();
  const cName = countryName(code);
  const flag = flagEmoji(code);
  const kind = !s.hasStatus ? 'mute' : !s.online ? 'bad' : lag ? 'warn' : 'ok';
  const windowLabel = data.hours <= 24 ? 'за 24 часа' : 'за 7 дней';
  const chartLoading = data.hours !== hours;

  const pct = s.maxPlayers > 0 ? Math.min(100, Math.round((s.players / s.maxPlayers) * 100)) : 0;
  const lt = loadTone(pct);
  const pt = s.ping != null ? pingTone(s.ping) : null;
  const meterCls = { ok: 'm-ok', warn: 'm-warn', bad: 'm-bad' }[lt];

  const nowTile = (i: number) => (
    <div key="now" className="tile tile-in p-4 sm:p-[18px]" style={stagger(i)}>
      <div className="stat-k">Сейчас</div>
      <div className="stat-v mt-1">
        {s.online ? <><AnimatedNumber value={s.players} delta />/{s.maxPlayers}</> : '–'}
      </div>
      {s.online && s.maxPlayers > 0 ? (
        <>
          <div
            className={`meter mt-2 ${meterCls}`}
            role="meter"
            aria-label="Заполненность сервера"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={`заполнено ${pct} %`}
          >
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="stat-s mt-1.5 flex flex-wrap items-center gap-x-2">
            <span className={TONE_TEXT[lt]}>заполнено {pct} %</span>
            {s.ping != null && pt && (
              <span className={`inline-flex items-center gap-1 ${TONE_TEXT[pt.tone]}`}>
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                пинг {s.ping} мс · {pt.label}
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="stat-s mt-1.5">{s.hasStatus ? 'сервер недоступен' : 'ожидаем первый ответ'}</div>
      )}
    </div>
  );
  const statTiles = (withNow: boolean, base = 0) => [
    withNow ? nowTile(base) : null,
    <StatTile key="peak" i={base + (withNow ? 1 : 0)} k="Пик игроков" hint={stats.peakAt ? fmtDateTime(stats.peakAt) : undefined}>
      {stats.peakPlayers == null ? '–' : String(stats.peakPlayers)}
    </StatTile>,
    <StatTile key="up" i={base + (withNow ? 2 : 1)} k="Аптайм" hint={windowLabel}>
      {stats.uptimePct == null ? '–' : `${stats.uptimePct}%`}
    </StatTile>,
    <StatTile key="avg" i={base + (withNow ? 3 : 2)} k="В среднем" hint="пока сервер онлайн">
      {stats.avgPlayers == null ? '–' : String(stats.avgPlayers)}
    </StatTile>,
    withNow ? null : (
      <StatTile key="n" i={base + 3} k="Измерений" hint={windowLabel}>{String(stats.samples)}</StatTile>
    ),
  ];

  const info: [string, string][] = [
    ['Игра', gameLabel(s.game)],
    ['Адрес', s.address],
    ...(s.map && s.online ? [['Карта', s.map] as [string, string]] : []),
    ...(realVersion ? [['Версия', realVersion] as [string, string]] : []),
    ...(mode ? [['Режим', mode] as [string, string]] : []),
    ...(cName ? [['Страна', `${flag} ${cName}`.trim()] as [string, string]] : []),
    ['Обновлено', ago(s.updatedAt)],
  ];

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
      window.location.hash = '#/servers';
    } catch (e) {
      setError((e as Error).message);
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

  const chartTile = (i: number, withSeries: boolean) => (
    <section className={`tile tile-in p-4 sm:p-5 ${withSeries ? 'lg:col-span-12' : 'lg:col-span-8'}`} style={stagger(i)} aria-label="График">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-extrabold">{withSeries ? (series === 'ping' ? 'Пинг' : 'Игроки') : 'Игроки'}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {withSeries && (
            <div className="seg" role="group" aria-label="Показатель">
              {([['players', 'Игроки'], ['ping', 'Пинг']] as [Series, string][]).map(([k, label]) => (
                <button key={k} type="button" className="seg-item" aria-pressed={series === k} onClick={() => setSeries(k)}>{label}</button>
              ))}
            </div>
          )}
          <PeriodSeg hours={hours} onChange={setHours} />
        </div>
      </div>
      {stats.samples < 2 ? (
        <p className="py-10 text-center font-semibold text-mute">Данных пока мало: график появится через несколько минут после добавления сервера.</p>
      ) : (
        <HistoryChart points={points} hours={data.hours} max={s.maxPlayers} color={series === 'ping' ? 'rgb(var(--link))' : color} series={withSeries ? series : 'players'} loading={chartLoading} />
      )}
      {points.some((p) => !p.online) && stats.samples >= 2 && (
        <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-mute"><span className="inline-block h-3 w-3 rounded bg-bad/30" /> Красным отмечены периоды, когда сервер не отвечал.</p>
      )}
    </section>
  );

  const aboutTile = (i: number) => (
    <section className="tile tile-in p-5 lg:col-span-4" style={stagger(i)}>
      <h2 className="mb-3 text-base font-extrabold">О сервере</h2>
      <dl className="space-y-2.5">
        {info.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-sm font-bold text-mute">{k}</dt>
            <dd className={`min-w-0 break-words text-right text-sm font-extrabold ${k === 'Адрес' ? 'break-all font-mono' : ''}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );

  const playersProps = { online: s.online, players: s.players, names: s.playerNames, list: data.playersNow ?? [], fresh };
  const playerCountBadge = s.online ? <span className="ml-2 rounded-full bg-soft px-2.5 py-0.5 text-xs font-extrabold text-link">{s.players}</span> : null;

  let panel: ReactNode;
  if (tab === 'players') {
    panel = (
      <section className="tile tile-in p-4 sm:p-5">
        <h2 className="mb-3 flex items-center text-base font-extrabold">Сейчас в игре{playerCountBadge}</h2>
        <PlayersList {...playersProps} />
      </section>
    );
  } else if (tab === 'history') {
    panel = (
      <div className="space-y-3.5">
        <div className="grid gap-3.5 lg:grid-cols-12">
          {chartTile(0, true)}
        </div>
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">{statTiles(false, 1)}</div>
      </div>
    );
  } else if (tab === 'events') {
    panel = (
      <section className="tile tile-in p-4 sm:p-5">
        <h2 className="mb-3 text-base font-extrabold">Журнал событий</h2>
        <EventsFeed events={events} online={s.online} />
      </section>
    );
  } else if (tab === 'connect') {
    panel = <ConnectTab game={s.game} address={s.address} />;
  } else {
    panel = (
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">{statTiles(true)}</div>
        <div className="grid gap-3.5 lg:grid-cols-12">
          {chartTile(4, false)}
          <section className="tile tile-in p-4 sm:p-5 lg:col-span-4" style={stagger(5)}>
            <h2 className="mb-3 flex items-center text-base font-extrabold">Сейчас в игре{playerCountBadge}</h2>
            <PlayersList {...playersProps} limit={6} moreHref={tabHref(id, 'players')} />
          </section>
          <section className="tile tile-in p-4 sm:p-5 lg:col-span-8" style={stagger(6)}>
            <h2 className="mb-3 text-base font-extrabold">Последние события</h2>
            <EventsFeed events={events} online={s.online} limit={5} moreHref={tabHref(id, 'events')} />
          </section>
          {aboutTile(7)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {back}

      <article
        className={`srv-banner srv-glow srv-${kind} depth relative overflow-hidden rounded-[26px] p-4 text-white sm:p-6`}
        style={{ background: coverBackground(s.coverUrl, `linear-gradient(120deg, ${c1}, ${c2})`, { strong: true, game: s.game }) }}
        {...depth}
      >
        <span aria-hidden className="depth-l1 pointer-events-none absolute -right-14 -top-20 h-64 w-64 rounded-full bg-white/15" />
        <span aria-hidden className="depth-l2 pointer-events-none absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-black/10" />
        {wentOffline && <span className="flash-ring" aria-hidden />}

        {/* title row */}
        <div className="relative flex items-start gap-3.5 sm:gap-4">
          <GameAvatar game={s.game} size={64} glass vtId={s.id} />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-[22px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[28px]">{s.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm font-bold text-white/90">
              <span>{gameLabel(s.game)}</span>
              <code className="min-w-0 break-all font-mono text-[13px] font-semibold">{s.address}</code>
            </div>
          </div>
          {me && <FavStar on={isFav} name={s.name} onClick={() => void toggleFav()} />}
        </div>

        {/* status row */}
        <div className="relative mt-3.5 flex flex-wrap items-center gap-2">
          <StatusPill glass online={s.online} known={s.hasStatus} lag={lag} />
          <LiveBadge at={s.updatedAt} />
          {cName && <span className="chip-glass" title="Страна сервера">{flag && <span aria-hidden>{flag}</span>}{cName}</span>}
          {realVersion && <span className="chip-glass" title="Версия игры">v{realVersion.replace(/^v/i, '')}</span>}
          {mode && <span className="chip-glass" title="Режим игры (по названию сервера)">{mode}</span>}
          {isFav && <span className="chip-glass"><span aria-hidden>★</span> В избранном</span>}
        </div>

        {!s.online && s.error && (
          <p className="relative mt-3.5 rounded-2xl bg-black/25 px-4 py-2.5 text-sm font-bold">{s.error}</p>
        )}

        {/* buttons: the main one, then the two equal glass ones; admin tools are a quieter group */}
        <div className="relative mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <a
            className="btn-cta col-span-2 sm:col-auto"
            href={guide.link?.href ?? tabHref(id, 'connect')}
            onClick={tab === 'connect' && !guide.link ? (e) => { e.preventDefault(); void copyAddress(); } : undefined}
          >
            {tab === 'connect' && !guide.link ? 'Скопировать адрес для входа' : 'Подключиться'}
          </a>
          <CopyButton text={s.address} label="Скопировать адрес" tone="glass" />
          <button type="button" className="btn-glass" onClick={() => void share()}>
            {shared ? <IconCheckMark /> : <IconShare />}
            Поделиться
          </button>
        </div>
        {isAdmin && (
          <div className="relative mt-3 grid grid-cols-3 gap-2 border-t border-white/15 pt-3 sm:flex sm:flex-wrap sm:items-center" role="group" aria-label="Управление сервером">
            <button className="btn-glass-quiet" onClick={refresh} disabled={busy} aria-busy={busy || undefined}><IconRefresh spinning={busy} />{busy ? 'Опрос…' : 'Опросить'}</button>
            <button className="btn-glass-quiet" onClick={() => setEditing(true)}>Изменить</button>
            <button className="btn-glass-quiet btn-glass-danger" onClick={remove}>Удалить</button>
          </div>
        )}
      </article>
      <ErrorLine text={error} />

      <ServerTabs id={id} tab={tab} counts={{ events: events.length, players: s.online ? s.players : 0 }} />

      <div key={tab || 'overview'} role="tabpanel" id={panelDomId(tab)} aria-labelledby={tabDomId(tab)}>
        {panel}
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
