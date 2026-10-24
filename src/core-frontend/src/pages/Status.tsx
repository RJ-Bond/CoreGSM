import { useAuth } from '../auth';
import { Icon } from '../icons';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { api, type StatusDay, type StatusIncident, type StatusInfo, type StatusServer } from '../api';
import { Empty, ErrorLine, GameAvatar, LoadError, PageHead, SmoothArea, StatusPill, ago, fmtDateTime, fmtTime, plural, usePoll } from '../ui';
import '../styles/status.css';

const fmtDay = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};
const fmtPct = (p: number) => `${(Math.round(p * 10) / 10).toLocaleString('ru-RU')}%`;
const dur = (min: number) => (min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч${min % 60 ? ` ${min % 60} мин` : ''}`);

const POLL_MS = 60_000;

const fmtShort = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
};

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';

/** a re-render every `ms` (for «обновлено N с назад») */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** the number counts up to its value and, on a later poll, from the old value to the new one */
function useCountUp(target: number, ms = 600) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  const first = useRef(true);
  useEffect(() => {
    if (reducedMotion()) { from.current = target; setV(target); return; }
    const a = first.current ? 0 : from.current;
    first.current = false;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const cur = a + (target - a) * (1 - (1 - p) ** 3);
      from.current = cur;
      setV(cur);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

const IconCheck = () => <Icon size={30}><path d="M20 6 9 17l-5-5" /></Icon>;
const IconWarn = () => <Icon size={30}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></Icon>;
const IconCross = () => <Icon size={30}><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></Icon>;
const IconServer = () => <Icon size={16}><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></Icon>;
const IconUsers = () => <Icon size={16}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></Icon>;
const IconAct = () => <Icon size={16}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></Icon>;
const IconAlert = () => <Icon size={16}><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></Icon>;

/** the colour of a day: by how long the server was down, not by a percentage that hides a 40-minute outage */
function dayTone(d: StatusDay): 'none' | 'ok' | 'blip' | 'warn' | 'bad' | 'planned' {
  if (d.pct == null) return 'none';
  const down = d.down ?? 0;
  if (down >= 60) return 'bad';
  if (down >= 15) return 'warn';
  if (down > 0) return 'blip';
  if ((d.planned ?? 0) > 0) return 'planned';
  return 'ok';
}

function dayText(d: StatusDay): string {
  if (d.pct == null) return `${fmtDay(d.day)}: нет данных`;
  const parts = [`${fmtDay(d.day)}: доступен ${fmtPct(d.pct)}`];
  if (d.down) parts.push(`простой ${dur(d.down)}${d.incidents && d.incidents > 1 ? `, ${d.incidents} ${plural(d.incidents, ['сбой', 'сбоя', 'сбоев'])}` : ''}`);
  else parts.push('без сбоев');
  if (d.planned) parts.push(`плановые работы ${dur(d.planned)}`);
  return parts.join(' · ');
}

function UptimeBar({ s }: { s: StatusServer }) {
  const [active, setActive] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const n = s.days.length;
  const summary = s.uptime30 == null ? 'Нет данных об аптайме за 30 дней' : `Аптайм за 30 дней: ${fmtPct(s.uptime30)}`;
  const at = (e: PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return null;
    return Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };
  const onKey = (e: KeyboardEvent) => {
    const cur = active ?? n - 1;
    if (e.key === 'ArrowLeft') setActive(Math.max(0, cur - 1));
    else if (e.key === 'ArrowRight') setActive(Math.min(n - 1, cur + 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };
  const d = active != null ? s.days[active] : null;
  return (
    <div className="st-uptime">
      <div
        ref={ref}
        className="st-bars"
        role="img"
        tabIndex={0}
        aria-label={`${summary}. Стрелками можно просмотреть дни`}
        onPointerMove={(e) => { if (e.pointerType === 'mouse') setActive(at(e)); }}
        onPointerDown={(e) => { const i = at(e); setActive((cur) => (e.pointerType !== 'mouse' && cur === i ? null : i)); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActive(null); }}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {s.days.map((x, i) => (
          <span key={x.day} className={`st-day is-${dayTone(x)} ${i === n - 1 ? 'is-today' : ''} ${active === i ? 'is-hover' : ''}`} />
        ))}
      </div>
      {d && active != null && (
        <div className={`st-tip ${active < 4 ? 'is-l' : active > n - 5 ? 'is-r' : ''}`} style={{ left: `${((active + 0.5) / n) * 100}%` }} aria-hidden>
          <div className="st-tip-day"><span className={`st-day st-legend is-${dayTone(d)}`} />{fmtDay(d.day)}</div>
          <div className="st-tip-main">{d.pct == null ? 'Нет данных' : `Доступен ${fmtPct(d.pct)}`}</div>
          {d.pct != null && <div className="st-tip-sub">{d.down ? `Простой ${dur(d.down)}${d.incidents && d.incidents > 1 ? `, ${d.incidents} ${plural(d.incidents, ['сбой', 'сбоя', 'сбоев'])}` : ''}` : 'Без сбоев'}</div>}
          {!!d.planned && <div className="st-tip-sub">Плановые работы {dur(d.planned)}</div>}
        </div>
      )}
      <div className="st-ticks" aria-hidden>
        {s.days.map((x, i) => (
          <span key={x.day} className="st-tick">
            {(n - 1 - i) % 7 === 0 && <em className={i === n - 1 ? 'is-last' : ''}>{i === n - 1 ? 'сегодня' : fmtShort(x.day)}</em>}
          </span>
        ))}
      </div>
      <div className="sr-only" aria-live="polite">{d ? dayText(d) : ''}</div>
    </div>
  );
}

/** the hourly average ping of the day: the 100 ms line, the worst hour marked, best / average / worst under it */
function Latency({ s }: { s: StatusServer }) {
  const vals = (s.latency ?? []).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  let prev = vals[0];
  const filled = (s.latency ?? []).map((v) => (v == null ? prev : (prev = v)));
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const top = Math.max(110, hi);
  const W = 200, H = 36, PAD = 3, scale = top * 1.12;
  const yOf = (v: number) => ((H - PAD - (v / scale) * (H - PAD * 2)) / H) * 100;
  const peak = filled.indexOf(Math.max(...filled));
  const showPeak = hi >= 1.3 * (s.avgPing ?? hi) && hi > lo;
  const tone = (s.avgPing ?? 0) > 100 ? 'rgb(var(--warn))' : 'rgb(var(--link))';
  return (
    <div className="st-lat">
      <div className="st-lat-k">Отклик за 24 ч</div>
      <div className="st-lat-chart">
        <SmoothArea values={filled} color={tone} w={W} h={H} fill={0.2} strokeWidth={1.8} className="h-9" max={top} label={`Пинг за 24 часа: от ${lo} до ${hi} мс`} />
        <span className="st-lat-limit" style={{ top: `${yOf(100)}%` }} aria-hidden><i>100</i></span>
        {showPeak && (
          <span className={`st-lat-peak ${hi > 100 ? 'is-high' : ''}`} style={{ left: `${((PAD + (peak / Math.max(1, filled.length - 1)) * (W - PAD * 2)) / W) * 100}%`, top: `${yOf(filled[peak])}%` }} title={`Максимум ${hi} мс`} aria-hidden />
        )}
      </div>
      <div className="st-lat-v">{s.avgPing != null ? `мин ${lo} · ср ${s.avgPing} · макс ${hi} мс` : '–'}</div>
    </div>
  );
}

function ServerRow({ s, index }: { s: StatusServer; index: number }) {
  const incidents30 = s.days.reduce((n, d) => n + (d.incidents ?? 0), 0);
  const lag = s.online && s.avgPing != null && s.avgPing > 100;
  const upTone = s.uptime30 == null ? 'none' : s.uptime30 >= 99.9 ? 'great' : s.uptime30 >= 99 ? 'good' : s.uptime30 >= 95 ? 'meh' : 'poor';
  const fill = s.maxPlayers > 0 ? Math.min(100, Math.round((s.players / s.maxPlayers) * 100)) : 0;
  return (
    <li className={`st-server tile tile-in is-${!s.online ? 'off' : lag ? 'lag' : 'on'}`} style={{ animationDelay: `${Math.min(index, 8) * 70}ms`, animationFillMode: 'backwards' }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <GameAvatar game={s.game} size={44} />
        <div className="min-w-0 flex-1 basis-40">
          <a href={`/servers/${s.id}`} className="block wrap-break-word text-[17px] font-extrabold leading-tight hover:text-link">{s.name}</a>
          <div className="truncate font-mono text-sm font-semibold text-mute">{s.address}</div>
        </div>
        {s.online && (
          <span className="st-players" title={`${s.players} из ${s.maxPlayers} игроков`}>
            <b>{s.players}/{s.maxPlayers} <span>игроков</span></b>
            <i className="st-meter" aria-hidden><i style={{ width: `${fill}%` }} /></i>
          </span>
        )}
        <StatusPill online={s.online} known lag={lag} />
      </div>
      <div className="st-server-body">
        <div className="min-w-0 flex-1">
          <UptimeBar s={s} />
        </div>
        <div className="st-server-side">
          <div className="st-up">
            <div className={`st-up-v is-${upTone}`}>{s.uptime30 == null ? '–' : fmtPct(s.uptime30)}</div>
            <div className="st-up-k">{incidents30 ? `${incidents30} ${plural(incidents30, ['сбой', 'сбоя', 'сбоев'])} за 30 дней` : 'без сбоев за 30 дней'}</div>
          </div>
          {s.avgPing != null && <div className="st-ping-inline">пинг {s.avgPing} мс</div>}
          <Latency s={s} />
        </div>
      </div>
    </li>
  );
}

function Banner({ data, fetchedAt }: { data: StatusInfo; fetchedAt: number }) {
  const servers = data.servers;
  const total = servers.length;
  const up = servers.filter((s) => s.online).length;
  const ongoing = (data.incidents ?? []).filter((i) => i.end == null && !i.planned).length;
  const lastBad = (data.incidents ?? []).find((i) => !i.planned);
  const ups = servers.map((s) => s.uptime30).filter((v): v is number => v != null);
  const avg = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;
  const players = servers.reduce((n, s) => n + (s.online ? s.players : 0), 0);
  const upN = Math.round(useCountUp(up));
  const playersN = Math.round(useCountUp(players));
  const avgN = useCountUp(avg ?? 0);
  const [tone, title, text] = up === total
    ? ['ok', 'Все серверы работают', 'Игроки могут заходить на любой сервер.']
    : up === 0
      ? ['bad', 'Все серверы недоступны', 'Мы уже видим проблему: страница обновится сама, когда серверы вернутся.']
      : ['warn', `${total - up} ${plural(total - up, ['сервер недоступен', 'сервера недоступны', 'серверов недоступны'])}`, 'Остальные работают в обычном режиме.'];
  const last = ongoing > 0 ? 'Сбой продолжается прямо сейчас' : lastBad ? `Последний сбой: ${ago(lastBad.start)}` : 'За 30 дней сбоев не было';
  return (
    <section className={`st-banner is-${tone}`} role="status">
      <span className="st-banner-ico" aria-hidden>{tone === 'ok' ? <IconCheck /> : tone === 'warn' ? <IconWarn /> : <IconCross />}</span>
      <div className="min-w-0 flex-1 basis-60">
        <h2 className="text-2xl font-black leading-tight sm:text-3xl">{title}</h2>
        <p className="mt-1 font-semibold opacity-85">{text}</p>
        <div className="st-segs" role="img" aria-label={`Онлайн ${up} из ${total}`}>
          {servers.map((s) => (
            <span key={s.id} className={`st-seg ${!s.online ? 'is-down' : s.avgPing != null && s.avgPing > 100 ? 'is-lag' : 'is-up'}`} title={`${s.name}: ${s.online ? 'онлайн' : 'недоступен'}`} />
          ))}
        </div>
        <div className="st-banner-meta">
          <span>{last}</span>
          <Refresh fetchedAt={fetchedAt} />
        </div>
      </div>
      <dl className="st-banner-stats">
        <div><dt><IconServer />Онлайн</dt><dd>{upN} из {total}</dd></div>
        <div><dt><IconUsers />Игроков</dt><dd>{playersN}</dd></div>
        <div><dt><IconAct />Аптайм 30 дн</dt><dd>{avg == null ? '–' : fmtPct(avgN)}</dd></div>
        {ongoing > 0 && <div className="is-alert"><dt><IconAlert />Сбоев сейчас</dt><dd>{ongoing}</dd></div>}
      </dl>
    </section>
  );
}

/** «обновлено 12 с назад» with a ring that fills up to the next poll */
function Refresh({ fetchedAt }: { fetchedAt: number }) {
  const now = useNow(1000);
  const p = Math.min(1, Math.max(0, (now - fetchedAt) / POLL_MS));
  const C = 2 * Math.PI * 7;
  return (
    <span className="st-refresh">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r="7" className="st-ring-bg" />
        <circle cx="9" cy="9" r="7" className="st-ring" strokeDasharray={C} strokeDashoffset={C * (1 - p)} />
      </svg>
      обновлено {ago(fetchedAt)}
    </span>
  );
}

function IncidentItem({ i }: { i: StatusIncident }) {
  const live = i.end == null;
  const kind = i.planned ? 'planned' : live ? 'live' : 'past';
  return (
    <li className={`st-inc is-${kind}`}>
      <GameAvatar game={i.game} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-extrabold">{i.serverName}</span>
          <span className={`st-inc-badge is-${kind}`}>{i.planned ? 'Плановые работы' : live ? 'Продолжается' : 'Решено'}</span>
        </div>
        <p className="text-sm font-semibold text-mute">
          {live ? `Не отвечает ${dur(i.minutes)}, с ${fmtTime(i.start)}` : `Недоступен ${dur(i.minutes)}: ${fmtTime(i.start)} – ${fmtTime(i.end!)}`}
          {i.playersBefore > 0 && ` · в игре было ${i.playersBefore} ${plural(i.playersBefore, ['игрок', 'игрока', 'игроков'])}`}
        </p>
      </div>
      <time className="shrink-0 text-xs font-bold text-mute" dateTime={new Date(i.start).toISOString()} title={fmtDateTime(i.start)}>{ago(i.start)}</time>
    </li>
  );
}

const PAGE = 10;

/** incidents of the 30 days grouped by day, newest first; ten at first, then «Показать ещё» */
function Incidents({ list }: { list: StatusIncident[] }) {
  const [shown, setShown] = useState(PAGE);
  const groups = useMemo(() => {
    const m = new Map<string, StatusIncident[]>();
    for (const i of list.slice(0, shown)) {
      const key = new Date(i.start).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
      m.set(key, [...(m.get(key) ?? []), i]);
    }
    return [...m];
  }, [list, shown]);
  return (
    <section className="tile tile-in p-4 sm:p-5">
      <h2 className="mb-3 text-lg font-extrabold">История сбоев</h2>
      {list.length === 0 ? (
        <div className="st-calm">
          <span aria-hidden>✨</span>
          <div>
            <p className="font-extrabold">За 30 дней ни одного сбоя</p>
            <p className="text-sm font-semibold text-mute">Все серверы отвечали на каждый опрос.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([day, items]) => (
            <div key={day}>
              <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-mute">{day}</h3>
              <ul className="st-tl">{items.map((i) => <IncidentItem key={`${i.serverId}-${i.start}`} i={i} />)}</ul>
            </div>
          ))}
          {list.length > shown && (
            <button type="button" className="btn btn-soft" onClick={() => setShown((n) => n + PAGE)}>Показать ещё ({list.length - shown})</button>
          )}
        </div>
      )}
    </section>
  );
}

const LEGEND: [string, string][] = [
  ['ok', 'без сбоев'],
  ['blip', 'до 15 мин'],
  ['warn', '15–60 мин'],
  ['bad', 'больше часа'],
  ['planned', 'плановые работы'],
  ['none', 'нет данных'],
];

/** Public status page: the state now, 30 days of availability per server and the incidents behind it. */
const IconPulse = () => <Icon size={22}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></Icon>;

export default function StatusPage() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState<StatusInfo | null>(null);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());

  const load = () =>
    api<StatusInfo>('/status')
      .then((r) => { setData(r); setFetchedAt(Date.now()); setError(''); })
      .catch((e: Error) => setError(e.message));
  usePoll(load, POLL_MS);
  const month = data ? (data.incidents ?? []).filter((i) => !i.planned).length : 0;
  const subtitle = data && data.servers.length > 0
    ? `${data.servers.length} ${plural(data.servers.length, ['сервер', 'сервера', 'серверов'])} · ${month ? `${month} ${plural(month, ['сбой', 'сбоя', 'сбоев'])} за 30 дней` : 'без сбоев за 30 дней'}`
    : 'Доступность серверов и история сбоев за 30 дней';

  return (
    <div className="space-y-5">
      <PageHead icon={<IconPulse />} title="Статус" subtitle={subtitle} />
      {error && !data ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}

      {!data && !error && (
        <div className="space-y-3" aria-busy="true" aria-label="Загрузка">
          <div className="skeleton panel h-28" />
          <div className="skeleton panel h-36" />
          <div className="skeleton panel h-36" />
        </div>
      )}

      {data && data.servers.length === 0 && (
        <Empty title="Серверов пока нет" text="Когда серверы будут добавлены, здесь появится их доступность.">{isAdmin && <a href="/admin/servers/new" className="btn mt-2">Добавить сервер</a>}</Empty>
      )}

      {data && data.servers.length > 0 && (
        <div className="fade-in space-y-5">
          <Banner data={data} fetchedAt={fetchedAt} />
          <ul className="space-y-3">
            {data.servers.map((s, i) => <ServerRow key={s.id} s={s} index={i} />)}
          </ul>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold text-mute">
            {LEGEND.map(([c, t]) => (
              <span key={t} className="inline-flex items-center gap-1.5"><span className={`st-day st-legend is-${c}`} aria-hidden />{t}</span>
            ))}
          </div>
          <Incidents list={data.incidents ?? []} />
        </div>
      )}
    </div>
  );
}
