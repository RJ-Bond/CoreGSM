import { useMemo, useState } from 'react';
import { api, type StatusDay, type StatusIncident, type StatusInfo, type StatusServer } from '../api';
import { Empty, ErrorLine, GameAvatar, LoadError, IconServers, PageHead, SmoothArea, StatusPill, ago, fmtDateTime, fmtTime, plural, usePoll } from '../ui';
import '../styles/status.css';

const fmtDay = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};
const fmtPct = (p: number) => `${(Math.round(p * 10) / 10).toLocaleString('ru-RU')}%`;
const dur = (min: number) => (min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч${min % 60 ? ` ${min % 60} мин` : ''}`);

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
  const [hover, setHover] = useState<number | null>(null);
  const summary = s.uptime30 == null ? 'Нет данных об аптайме за 30 дней' : `Аптайм за 30 дней: ${fmtPct(s.uptime30)}`;
  return (
    <div>
      <div className="st-bars" role="img" aria-label={summary} onMouseLeave={() => setHover(null)}>
        {s.days.map((d, i) => (
          <span key={d.day} className={`st-day is-${dayTone(d)} ${hover === i ? 'is-hover' : ''}`} title={dayText(d)} onMouseEnter={() => setHover(i)} />
        ))}
      </div>
      <div className="st-bars-foot">
        <span>30 дней назад</span>
        <span className="st-bars-read" aria-live="polite">{hover != null ? dayText(s.days[hover]) : ''}</span>
        <span>сегодня</span>
      </div>
    </div>
  );
}

/** the hourly average ping of the day */
function Latency({ s }: { s: StatusServer }) {
  const vals = (s.latency ?? []).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  let prev = vals[0];
  const filled = (s.latency ?? []).map((v) => (v == null ? prev : (prev = v)));
  const tone = (s.avgPing ?? 0) > 100 ? 'rgb(var(--warn))' : 'rgb(var(--link))';
  return (
    <div className="st-lat">
      <div className="st-lat-k">Отклик за 24 ч</div>
      <SmoothArea values={filled} color={tone} w={200} h={36} fill={0.2} strokeWidth={1.8} className="h-9" label={`Пинг за 24 часа: от ${Math.min(...vals)} до ${Math.max(...vals)} мс`} />
      <div className="st-lat-v">{s.avgPing != null ? `${s.avgPing} мс` : '–'}</div>
    </div>
  );
}

function ServerRow({ s }: { s: StatusServer }) {
  const incidents30 = s.days.reduce((n, d) => n + (d.incidents ?? 0), 0);
  return (
    <li className="st-server tile tile-in">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <GameAvatar game={s.game} size={44} />
        <div className="min-w-0 flex-1 basis-40">
          <a href={`/servers/${s.id}`} className="block break-words text-[17px] font-extrabold leading-tight hover:text-link">{s.name}</a>
          <div className="truncate font-mono text-sm font-semibold text-mute">{s.address}</div>
        </div>
        {s.online && <span className="text-sm font-bold tabular-nums text-mute">{s.players}/{s.maxPlayers} игроков</span>}
        <StatusPill online={s.online} known lag={s.online && s.avgPing != null && s.avgPing > 100} />
      </div>
      <div className="st-server-body">
        <div className="min-w-0 flex-1">
          <UptimeBar s={s} />
        </div>
        <div className="st-server-side">
          <div className="st-up">
            <div className="st-up-v">{s.uptime30 == null ? '–' : fmtPct(s.uptime30)}</div>
            <div className="st-up-k">{incidents30 ? `${incidents30} ${plural(incidents30, ['сбой', 'сбоя', 'сбоев'])} за 30 дней` : 'без сбоев за 30 дней'}</div>
          </div>
          <Latency s={s} />
        </div>
      </div>
    </li>
  );
}

function Banner({ data }: { data: StatusInfo }) {
  const servers = data.servers;
  const total = servers.length;
  const up = servers.filter((s) => s.online).length;
  const ongoing = (data.incidents ?? []).filter((i) => i.end == null && !i.planned).length;
  const ups = servers.map((s) => s.uptime30).filter((v): v is number => v != null);
  const avg = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;
  const players = servers.reduce((n, s) => n + (s.online ? s.players : 0), 0);
  const [tone, title, text] = up === total
    ? ['ok', 'Все серверы работают', 'Игроки могут заходить на любой сервер.']
    : up === 0
      ? ['bad', 'Все серверы недоступны', 'Мы уже видим проблему: страница обновится сама, когда серверы вернутся.']
      : ['warn', `${total - up} ${plural(total - up, ['сервер недоступен', 'сервера недоступны', 'серверов недоступны'])}`, 'Остальные работают в обычном режиме.'];
  return (
    <section className={`st-banner is-${tone}`} role="status">
      <span className="st-banner-dot" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 className="text-2xl font-black leading-tight sm:text-3xl">{title}</h2>
        <p className="mt-1 font-semibold opacity-85">{text}</p>
      </div>
      <dl className="st-banner-stats">
        <div><dt>Онлайн</dt><dd>{up} из {total}</dd></div>
        <div><dt>Игроков</dt><dd>{players}</dd></div>
        <div><dt>Аптайм 30 дн</dt><dd>{avg == null ? '–' : fmtPct(avg)}</dd></div>
        {ongoing > 0 && <div><dt>Сбоев сейчас</dt><dd>{ongoing}</dd></div>}
      </dl>
    </section>
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

/** incidents of the 30 days grouped by day, newest first */
function Incidents({ list }: { list: StatusIncident[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, StatusIncident[]>();
    for (const i of list) {
      const key = new Date(i.start).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
      m.set(key, [...(m.get(key) ?? []), i]);
    }
    return [...m];
  }, [list]);
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
              <ul className="space-y-2">{items.map((i) => <IncidentItem key={`${i.serverId}-${i.start}`} i={i} />)}</ul>
            </div>
          ))}
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
export default function StatusPage() {
  const [data, setData] = useState<StatusInfo | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    api<StatusInfo>('/status')
      .then((r) => { setData(r); setError(''); })
      .catch((e: Error) => setError(e.message));
  usePoll(load, 60_000);

  return (
    <div className="space-y-5">
      <PageHead icon={<IconServers />} title="Статус" subtitle="Доступность серверов и история сбоев за 30 дней" />
      {error && !data ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}

      {!data && !error && (
        <div className="space-y-3" aria-busy="true" aria-label="Загрузка">
          <div className="skeleton panel h-28" />
          <div className="skeleton panel h-36" />
          <div className="skeleton panel h-36" />
        </div>
      )}

      {data && data.servers.length === 0 && (
        <Empty title="Серверов пока нет" text="Когда серверы будут добавлены, здесь появится их доступность." />
      )}

      {data && data.servers.length > 0 && (
        <div className="fade-in space-y-5">
          <Banner data={data} />
          <ul className="space-y-3">
            {data.servers.map((s) => <ServerRow key={s.id} s={s} />)}
          </ul>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold text-mute">
            {LEGEND.map(([c, t]) => (
              <span key={t} className="inline-flex items-center gap-1.5"><span className={`st-day st-legend is-${c}`} aria-hidden />{t}</span>
            ))}
            <span className="ml-auto">обновлено {ago(data.updatedAt)}</span>
          </div>
          <Incidents list={data.incidents ?? []} />
        </div>
      )}
    </div>
  );
}
