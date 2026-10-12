import { useEffect, useId, useRef, useState } from 'react';
import { api, ApiError, type PlayerNow, type ServerDetails } from '../api';
import { useAuth } from '../auth';
import { COUNTRIES } from '../countries';
import { gameColor, gameGradient, gameLabel } from '../games';
import { CopyButton, Empty, ErrorLine, GameAvatar, StatusPill, ago, fmtDateTime, plural, smoothPath, toast, usePoll } from '../ui';
import { confirmDialog } from '../confirm';
import ServerForm from './ServerForm';

type Point = ServerDetails['points'][number];

const SOURCE_GAMES = new Set(['counterstrike2', 'csgo', 'counterstrike16', 'css', 'teamfortress2', 'garrysmod', 'l4d2', 'rust', 'ase', 'dayz']);

/** steam://connect link for Source-like games; other games have no universal "join" link. */
function connectUrl(game: string, address: string, port: number): string | null {
  if (!SOURCE_GAMES.has(game)) return null;
  return `steam://connect/${address.includes(':') || !port ? address : `${address}:${port}`}`;
}

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return Math.max(4, Math.ceil(nice * p));
}

const tickLabel = (ts: number, hours: number) =>
  hours <= 24
    ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

/** Player count over time: smooth area, red bands where the server was unreachable, hover tooltip. */
function PlayersChart({ points, hours, max, color }: { points: Point[]; hours: number; max: number; color: string }) {
  const L = 36, R = 8, T = 12, B = 28;
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const gid = useId();
  // the drawing is 1:1 with the screen, so labels keep a readable size on phones
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.round(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(280, Math.round(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  const H = W < 520 ? 200 : 250;

  const now = Date.now();
  const t0 = now - hours * 3600_000;
  const x = (ts: number) => L + ((ts - t0) / (now - t0)) * (W - L - R);
  const yMax = niceMax(Math.max(max, ...points.map((p) => p.players), 1));
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const bucket = (now - t0) / 180;

  // continuous online runs become separate curves; a gap is much wider than the usual spacing of the samples
  const spacing = points.length > 1 ? [...points.slice(1).map((p, i) => p.ts - points[i].ts)].sort((a, b) => a - b)[Math.floor((points.length - 1) / 2)] : bucket;
  const gap = Math.max(bucket * 2.5, spacing * 2.5);
  const segments: Point[][] = [];
  let cur: Point[] = [];
  for (const p of points) {
    if (p.online) {
      if (cur.length && p.ts - cur[cur.length - 1].ts > gap) { segments.push(cur); cur = []; }
      cur.push(p);
    } else if (cur.length) { segments.push(cur); cur = []; }
  }
  if (cur.length) segments.push(cur);
  const xy = (seg: Point[]): [number, number][] => seg.map((p) => [x(p.ts), y(p.players)]);

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || points.length === 0) return;
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.ts) - vx) < Math.abs(x(points[best].ts) - vx)) best = i; });
    setHover(best);
  };

  const hp = hover != null ? points[hover] : null;
  const gridVals = [0, 1, 2, 3, 4].map((i) => (yMax / 4) * i);
  const lastSeg = segments[segments.length - 1];
  const endPt = lastSeg && now - lastSeg[lastSeg.length - 1].ts < gap ? lastSeg[lastSeg.length - 1] : null;

  return (
    <div className="relative" ref={wrap}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-pan-y"
        role="img"
        aria-label={`Игроки за ${hours <= 24 ? 'сутки' : 'неделю'}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.34" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth="1" strokeDasharray={v === 0 ? undefined : '3 5'} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-mute" fontSize="12" fontWeight="700">{Math.round(v * 10) / 10}</text>
          </g>
        ))}
        {[0, 1, 2, 3, 4].map((i) => {
          const ts = t0 + ((now - t0) * i) / 4;
          return <text key={i} x={x(ts)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} className="fill-mute" fontSize="12" fontWeight="700">{tickLabel(ts, hours)}</text>;
        })}
        {max > 0 && max < yMax && <line x1={L} x2={W - R} y1={y(max)} y2={y(max)} className="stroke-mute" strokeDasharray="4 4" strokeWidth="1" opacity="0.5" />}
        {points.filter((p) => !p.online).map((p) => (
          <rect key={p.ts} x={x(p.ts) - (W - L - R) / 360} y={T} width={(W - L - R) / 180} height={H - T - B} className="fill-bad" opacity="0.2" />
        ))}
        {segments.map((seg, i) => {
          const pts = xy(seg);
          const d = smoothPath(pts);
          return (
            <g key={i}>
              {seg.length === 1 && <circle cx={pts[0][0]} cy={pts[0][1]} r="3.5" fill={color} />}
              {seg.length > 1 && <path d={`${d} L${pts[pts.length - 1][0].toFixed(1)},${y(0)} L${pts[0][0].toFixed(1)},${y(0)} Z`} fill={`url(#${gid})`} />}
              {seg.length > 1 && <path d={d} fill="none" stroke={color} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />}
            </g>
          );
        })}
        {endPt && !hp && (
          <>
            <circle cx={x(endPt.ts)} cy={y(endPt.players)} r="9" fill={color} opacity="0.22" />
            <circle cx={x(endPt.ts)} cy={y(endPt.players)} r="4.5" fill={color} className="stroke-card" strokeWidth="2" />
          </>
        )}
        {hp && <line x1={x(hp.ts)} x2={x(hp.ts)} y1={T} y2={H - B} className="stroke-mute" strokeWidth="1" opacity="0.6" />}
        {hp && hp.online ? <circle cx={x(hp.ts)} cy={y(hp.players)} r="5" fill={color} className="stroke-card" strokeWidth="2.5" /> : null}
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-xl bg-ink px-2.5 py-1 text-sm font-bold text-page shadow-pop"
          style={{ left: `${Math.min(84, Math.max(16, (x(hp.ts) / W) * 100))}%` }}
        >
          {fmtDateTime(hp.ts)} · {hp.online ? `${hp.players} ${plural(hp.players, ['игрок', 'игрока', 'игроков'])}` : 'недоступен'}
        </div>
      )}
    </div>
  );
}

/** "1 ч 12 мин" */
function playedFor(since: number, now: number): string {
  const m = Math.max(0, Math.floor((now - since) / 60_000));
  if (m < 1) return 'меньше минуты';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч ${m % 60} мин`;
  return `${Math.floor(h / 24)} д ${h % 24} ч`;
}

function PlayersNow({ online, players, names, list }: { online: boolean; players: number; names: string[]; list: PlayerNow[] }) {
  // the "in game for" labels advance while the page stays open
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const sorted = [...list].sort((a, b) => a.since - b.since);
  const hiddenCount = Math.max(0, players - (sorted.length || names.length));

  return (
    <section className="tile h-full p-5">
      <h2 className="mb-3 flex items-center text-base font-extrabold">Сейчас в игре{online && <span className="ml-2 rounded-full bg-soft px-2.5 py-0.5 text-xs font-extrabold text-link">{players}</span>}</h2>
      {!online ? (
        <p className="font-semibold text-mute">Сервер недоступен.</p>
      ) : sorted.length > 0 ? (
        <>
          <ul className="max-h-72 divide-y divide-line overflow-y-auto pr-1">
            {sorted.map((p, i) => (
              <li key={`${p.name}-${p.since}-${i}`} className="flex items-center gap-3 py-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-soft text-sm font-extrabold text-link" aria-hidden>
                  {(Array.from(p.name.trim())[0] ?? '?').toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate font-bold">{p.name || 'Без имени'}</span>
                <span className="shrink-0 text-sm font-semibold text-mute">в игре {playedFor(p.since, now)}</span>
              </li>
            ))}
          </ul>
          {hiddenCount > 0 && <p className="mt-2 text-sm font-bold text-mute">и ещё {hiddenCount}</p>}
        </>
      ) : names.length > 0 ? (
        <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto">
          {names.map((n, i) => <span key={`${n}-${i}`} className="rounded-full bg-soft px-3 py-1 text-sm font-bold">{n}</span>)}
          {hiddenCount > 0 && <span className="px-1 py-1 text-sm font-bold text-mute">и ещё {hiddenCount}</span>}
        </div>
      ) : (
        <p className="font-semibold text-mute">{players > 0 ? 'Игра не передаёт имена игроков.' : 'Пока никого нет.'}</p>
      )}
    </section>
  );
}

/** key={id}: switching between servers starts from a clean state */
export default function ServerDetail({ id }: { id: number }) {
  return <ServerDetailView key={id} id={id} />;
}

const FLAGS = (code: string) =>
  code.length === 2 ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';

function ServerDetailView({ id }: { id: number }) {
  const { isAdmin } = useAuth();
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<ServerDetails | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const firstHours = useRef(true);

  // only the newest request may update the page
  const load = (h = hours) => {
    const n = ++seq.current;
    return api<ServerDetails>(`/servers/${id}/details?hours=${h}`)
      .then((d) => { if (n !== seq.current) return; setData(d); setError(''); setMissing(false); })
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

  if (missing) {
    return (
      <Empty title="Сервер не найден" text="Возможно, его удалили.">
        <a className="btn mt-3" href="#/servers">К списку серверов</a>
      </Empty>
    );
  }
  if (!data) return <div className="skeleton tile h-64" />;

  const { server: s, stats, events, points } = data;
  const color = gameColor(s.game);
  const [c1, c2] = gameGradient(s.game);
  const lag = s.ping != null && s.ping > 100;
  const link = connectUrl(s.game, s.address, s.port);
  // placeholder versions such as 0.0.0.1 say nothing
  const realVersion = s.version && !/^0(\.0)*(\.\d+)?$/.test(s.version.trim()) ? s.version.trim() : null;
  const tiles: [string, string, string?][] = [
    ['Сейчас', s.online ? `${s.players}/${s.maxPlayers}` : '–', s.online && s.ping != null ? `пинг ${s.ping} мс` : undefined],
    ['Пик игроков', stats.peakPlayers == null ? '–' : String(stats.peakPlayers), stats.peakAt ? fmtDateTime(stats.peakAt) : undefined],
    ['Аптайм', stats.uptimePct == null ? '–' : `${stats.uptimePct}%`, hours <= 24 ? 'за 24 часа' : 'за 7 дней'],
    ['В среднем', stats.avgPlayers == null ? '–' : String(stats.avgPlayers), 'пока сервер онлайн'],
  ];
  const countryName = s.country ? COUNTRIES.find(([c]) => c === s.country)?.[1] ?? s.country : '';
  const info: [string, string][] = [
    ['Игра', gameLabel(s.game)],
    ['Адрес', s.address],
    ...(s.map && s.online ? [['Карта', s.map] as [string, string]] : []),
    ...(realVersion ? [['Версия', realVersion] as [string, string]] : []),
    ...(countryName ? [['Страна', `${FLAGS(s.country)} ${countryName}`.trim()] as [string, string]] : []),
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

  return (
    <div className="space-y-3.5">
      <a href="#/servers" className="ml-1 inline-flex min-h-[44px] items-center gap-1 font-extrabold text-link hover:underline md:min-h-0">← Все серверы</a>

      <article
        className="relative overflow-hidden rounded-[26px] p-5 text-white sm:p-6"
        style={{ background: `linear-gradient(120deg, ${c1}, ${c2})`, boxShadow: `0 1px 2px rgba(20,24,40,.06), 0 18px 40px -14px ${c1}88` }}
      >
        <span aria-hidden className="pointer-events-none absolute -right-14 -top-20 h-64 w-64 rounded-full bg-white/15" />
        <div className="relative flex flex-wrap items-center gap-x-5 gap-y-4">
          <GameAvatar game={s.game} size={68} glass />
          <div className="min-w-0 flex-1 basis-64">
            <h1 className="break-words text-2xl font-extrabold leading-tight tracking-[-0.02em] sm:text-[28px]">{s.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-bold text-white/90">
              <span>{gameLabel(s.game)}{realVersion ? ` · ${realVersion}` : ''}</span>
              <code className="font-mono text-[13px] font-semibold">{s.address}</code>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill online={s.online} known={s.hasStatus} lag={lag} />
            <CopyButton text={s.address} label="Скопировать адрес" tone="grad" />
            <button type="button" className="btn-ghost-on-grad" onClick={() => void share()}>Поделиться</button>
            {link && <a className="btn-ghost-on-grad" href={link}>Подключиться</a>}
          </div>
        </div>
        {!s.online && s.error && (
          <p className="relative mt-4 rounded-2xl bg-black/20 px-4 py-2.5 text-sm font-bold">{s.error}</p>
        )}
        <div className="relative mt-4 flex flex-wrap items-center gap-2">
          {isAdmin && (
            <>
              <button className="btn-ghost-on-grad" onClick={refresh} disabled={busy}>{busy ? 'Опрашиваю…' : 'Опросить сейчас'}</button>
              <button className="btn-ghost-on-grad" onClick={() => setEditing(true)}>Изменить</button>
              <button className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-extrabold text-[#b42323] transition hover:bg-white/90 max-sm:min-h-[44px]" onClick={remove}>Удалить</button>
            </>
          )}
          <span className="ml-auto text-sm font-bold text-white/90">обновлено {ago(s.updatedAt)}</span>
        </div>
      </article>
      <ErrorLine text={error} />

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {tiles.map(([k, v, hint]) => (
          <div key={k} className="tile p-4 sm:p-[18px]">
            <div className="stat-k">{k}</div>
            <div className="stat-v mt-1 truncate">{v}</div>
            {hint && <div className="stat-s mt-0.5 truncate">{hint}</div>}
          </div>
        ))}
      </div>

      <div className="grid gap-3.5 lg:grid-cols-12">
        <section className="tile p-5 lg:col-span-8" aria-label="График игроков">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-extrabold">Игроки</h2>
            <div className="seg" role="group" aria-label="Период">
              {[[24, '24 ч'], [168, '7 дн']].map(([h, label]) => (
                <button key={h} type="button" onClick={() => setHours(h as number)} aria-pressed={hours === h} className="seg-item">
                  {label}
                </button>
              ))}
            </div>
          </div>
          {stats.samples < 2 ? (
            <p className="py-10 text-center font-semibold text-mute">Данных пока мало: график появится через несколько минут после добавления сервера.</p>
          ) : (
            <PlayersChart points={points} hours={hours} max={s.maxPlayers} color={color} />
          )}
          {points.some((p) => !p.online) && stats.samples >= 2 && (
            <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-mute"><span className="inline-block h-3 w-3 rounded bg-bad/30" /> Красным отмечены периоды, когда сервер не отвечал.</p>
          )}
        </section>

        <div className="lg:col-span-4">
          <PlayersNow online={s.online} players={s.players} names={s.playerNames} list={data.playersNow ?? []} />
        </div>

        <section className="tile p-5 lg:col-span-8">
          <h2 className="mb-3 text-base font-extrabold">Журнал событий</h2>
          {events.length === 0 ? (
            <p className="font-semibold text-mute">За выбранный период сбоев не было.</p>
          ) : (
            <ul className="space-y-2">
              {events.map((e) => (
                <li key={e.ts} className="flex items-center gap-3">
                  <span className={`pill ${e.type === 'down' ? 'pill-bad' : 'pill-ok'}`}>{e.type === 'down' ? 'ПАДЕНИЕ' : 'ВЕРНУЛСЯ'}</span>
                  <span className="font-bold">{fmtDateTime(e.ts)}</span>
                  <span className="ml-auto text-sm font-semibold text-mute">{ago(e.ts)}</span>
                </li>
              ))}
            </ul>
          )}
          {events.length > 0 && <p className="mt-3 text-sm font-semibold text-mute">{events.length} {plural(events.length, ['событие', 'события', 'событий'])} за период</p>}
        </section>

        <section className="tile p-5 lg:col-span-4">
          <h2 className="mb-3 text-base font-extrabold">О сервере</h2>
          <dl className="space-y-2.5">
            {info.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-sm font-bold text-mute">{k}</dt>
                <dd className={`min-w-0 break-words text-right text-sm font-extrabold ${k === 'Адрес' ? 'font-mono' : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {editing && (
        <ServerForm
          initial={{ name: s.customName, game: s.game, host: s.host, port: s.port, queryPort: s.queryPort, displayAddress: s.displayAddress, country: s.country }}
          id={s.id}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void load(); }}
        />
      )}
    </div>
  );
}
