import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type PlayerNow, type ServerDetails } from '../api';
import { useAuth } from '../auth';
import { gameColor, gameLabel } from '../games';
import { CopyButton, Empty, ErrorLine, GameAvatar, StatusPill, ago, fmtDateTime, plural, toast, usePoll } from '../ui';
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

/** Player count over time with red bands where the server was unreachable. */
function PlayersChart({ points, hours, max, color }: { points: Point[]; hours: number; max: number; color: string }) {
  const L = 40, R = 10, T = 12, B = 28;
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // the drawing is 1:1 with the screen, so labels keep a readable size on phones
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(300, Math.round(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(300, Math.round(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  const H = W < 520 ? 200 : 240;

  const now = Date.now();
  const t0 = now - hours * 3600_000;
  const x = (ts: number) => L + ((ts - t0) / (now - t0)) * (W - L - R);
  const yMax = niceMax(Math.max(max, ...points.map((p) => p.players), 1));
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const bucket = (now - t0) / 180;

  // continuous online runs become separate line segments; a gap is much wider than the usual spacing of the samples
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
  const path = (seg: Point[]) => seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)} ${y(p.players).toFixed(1)}`).join(' ');

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
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth="1" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-mute" fontSize="12">{Math.round(v * 10) / 10}</text>
          </g>
        ))}
        {[0, 1, 2, 3, 4].map((i) => {
          const ts = t0 + ((now - t0) * i) / 4;
          return <text key={i} x={x(ts)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} className="fill-mute" fontSize="12">{tickLabel(ts, hours)}</text>;
        })}
        {max > 0 && max < yMax && <line x1={L} x2={W - R} y1={y(max)} y2={y(max)} className="stroke-mute" strokeDasharray="4 4" strokeWidth="1" opacity="0.5" />}
        {points.filter((p) => !p.online).map((p) => (
          <rect key={p.ts} x={x(p.ts) - (W - L - R) / 360} y={T} width={(W - L - R) / 180} height={H - T - B} className="fill-bad" opacity="0.18" />
        ))}
        {segments.map((seg, i) => (
          <g key={i}>
            {seg.length === 1 && <circle cx={x(seg[0].ts)} cy={y(seg[0].players)} r="3.5" fill={color} />}
            {seg.length > 1 && <path d={`${path(seg)} L${x(seg[seg.length - 1].ts)} ${y(0)} L${x(seg[0].ts)} ${y(0)} Z`} fill={color} opacity="0.14" />}
            <path d={path(seg)} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {hp && <line x1={x(hp.ts)} x2={x(hp.ts)} y1={T} y2={H - B} className="stroke-mute" strokeWidth="1" opacity="0.6" />}
        {hp && hp.online ? <circle cx={x(hp.ts)} cy={y(hp.players)} r="4.5" fill={color} className="stroke-card" strokeWidth="2" /> : null}
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-xl bg-ink px-2.5 py-1 text-sm font-bold text-page shadow-pop"
          style={{ left: `${Math.min(88, Math.max(12, (x(hp.ts) / W) * 100))}%` }}
        >
          {fmtDateTime(hp.ts)} · {hp.online ? `${hp.players} игроков` : 'недоступен'}
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
    <div className="panel p-5">
      <h2 className="mb-3 text-lg font-black">Сейчас в игре{online ? `: ${players}` : ''}</h2>
      {!online ? (
        <p className="font-semibold text-mute">Сервер недоступен.</p>
      ) : sorted.length > 0 ? (
        <>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {sorted.map((p, i) => (
              <li key={`${p.name}-${p.since}-${i}`} className="flex items-center gap-3 rounded-2xl bg-soft px-3 py-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-card text-sm font-black text-link" aria-hidden>
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
    </div>
  );
}

/** key={id}: switching between servers starts from a clean state */
export default function ServerDetail({ id }: { id: number }) {
  return <ServerDetailView key={id} id={id} />;
}

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
  if (!data) return <div className="skeleton panel h-64" />;

  const { server: s, stats, events, points } = data;
  const color = gameColor(s.game);
  const lag = s.ping != null && s.ping > 100;
  const link = connectUrl(s.game, s.address, s.port);
  const tiles: [string, string, string?][] = [
    ['Сейчас', s.online ? `${s.players}/${s.maxPlayers}` : '–', s.online && s.ping != null ? `пинг ${s.ping} мс` : undefined],
    ['Аптайм', stats.uptimePct == null ? '–' : `${stats.uptimePct}%`, hours <= 24 ? 'за 24 часа' : 'за 7 дней'],
    ['Пик игроков', stats.peakPlayers == null ? '–' : String(stats.peakPlayers), stats.peakAt ? fmtDateTime(stats.peakAt) : undefined],
    ['В среднем', stats.avgPlayers == null ? '–' : String(stats.avgPlayers), 'пока сервер онлайн'],
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
    <div className="space-y-5">
      <a href="#/servers" className="inline-flex items-center gap-1 font-extrabold text-link hover:underline">← Все серверы</a>

      <div className="panel flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="flex min-w-0 items-center gap-4">
          <GameAvatar game={s.game} size={56} />
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-black leading-tight">{s.name}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-bold text-mute">
              <span>{gameLabel(s.game)}{s.version ? ` · ${s.version}` : ''}</span>
              <span className="font-mono text-sm">{s.address}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill online={s.online} known={s.hasStatus} lag={lag} />
          <CopyButton text={s.address} label="Адрес" />
          <button type="button" className="btn btn-soft btn-sm" onClick={() => void share()}>Поделиться</button>
          {link && <a className="btn btn-soft btn-sm" href={link}>Подключиться</a>}
        </div>
        {!s.online && s.error && (
          <p className="w-full rounded-2xl bg-badbg px-4 py-2.5 text-sm font-bold text-bad">{s.error}</p>
        )}
        <div className="flex w-full flex-wrap gap-2">
          {isAdmin && (
            <>
              <button className="btn btn-soft btn-sm" onClick={refresh} disabled={busy}>{busy ? 'Опрашиваю…' : 'Опросить сейчас'}</button>
              <button className="btn btn-soft btn-sm" onClick={() => setEditing(true)}>Изменить</button>
              <button className="btn btn-danger btn-sm" onClick={remove}>Удалить</button>
            </>
          )}
          <span className="ml-auto self-center text-sm font-semibold text-mute">обновлено {ago(s.updatedAt)}</span>
        </div>
      </div>
      <ErrorLine text={error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([k, v, hint]) => (
          <div key={k} className="panel px-5 py-4">
            <div className="text-sm font-extrabold text-mute">{k}</div>
            <div className="text-3xl font-black tabular-nums text-link">{v}</div>
            {hint && <div className="text-sm font-semibold text-mute">{hint}</div>}
          </div>
        ))}
      </div>

      <div className="panel p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black">Игроки</h2>
          <div className="flex rounded-full bg-soft p-1" role="group" aria-label="Период">
            {[[24, '24 часа'], [168, '7 дней']].map(([h, label]) => (
              <button key={h} onClick={() => setHours(h as number)} aria-pressed={hours === h} className={`rounded-full px-3.5 py-1 text-sm font-extrabold transition ${hours === h ? 'bg-brand text-white shadow-pop' : 'text-mute hover:text-ink'}`}>
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
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <PlayersNow online={s.online} players={s.players} names={s.playerNames} list={data.playersNow ?? []} />

        <div className="panel p-5">
          <h2 className="mb-3 text-lg font-black">Журнал событий</h2>
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
        </div>
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
