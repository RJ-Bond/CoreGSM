import { useState } from 'react';
import { api, type StatusDay, type StatusInfo, type StatusServer } from '../api';
import { Empty, ErrorLine, GameAvatar, LoadError, IconServers, PageHead, StatusPill, ago, usePoll } from '../ui';

const dayColor = (pct: number | null) =>
  pct == null ? 'bg-line' : pct >= 99.9 ? 'bg-ok' : pct >= 95 ? 'bg-ok/60' : pct >= 80 ? 'bg-warn' : 'bg-bad';

const fmtDay = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};
const fmtPct = (p: number) => `${(Math.round(p * 10) / 10).toLocaleString('ru-RU')}%`;
const dayTitle = (d: StatusDay) => (d.pct == null ? `${fmtDay(d.day)}: нет данных` : `${fmtDay(d.day)}: ${fmtPct(d.pct)}`);

function UptimeBar({ s }: { s: StatusServer }) {
  const withData = s.days.filter((d) => d.pct != null);
  const summary = s.uptime30 == null
    ? 'Нет данных об аптайме за 30 дней'
    : `Аптайм за 30 дней: ${fmtPct(s.uptime30)}; дней без данных: ${s.days.length - withData.length}`;
  return (
    <div className="flex h-8 w-full min-w-0 gap-[2px] sm:gap-[3px]" role="img" aria-label={summary}>
      {s.days.map((d) => (
        <span key={d.day} title={dayTitle(d)} className={`h-full min-w-0 flex-1 rounded-[3px] ${dayColor(d.pct)}`} />
      ))}
    </div>
  );
}

function ServerRow({ s }: { s: StatusServer }) {
  return (
    <li className="panel space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <GameAvatar game={s.game} size={40} />
        <div className="min-w-0 flex-1 basis-40">
          <a href={`/servers/${s.id}`} className="block break-words font-extrabold leading-tight hover:text-link">{s.name}</a>
          <div className="truncate font-mono text-sm font-semibold text-mute">{s.address}</div>
        </div>
        {s.online && <span className="text-sm font-bold tabular-nums text-mute">{s.players}/{s.maxPlayers}{s.avgPing != null ? ` · ${s.avgPing} мс` : ''}</span>}
        <StatusPill online={s.online} known lag={s.online && s.avgPing != null && s.avgPing > 100} />
      </div>
      <div className="flex items-center gap-3">
        <UptimeBar s={s} />
        <div className="w-16 shrink-0 text-right text-sm font-black tabular-nums sm:w-20 sm:text-base">
          {s.uptime30 == null ? <span className="text-mute">–</span> : fmtPct(s.uptime30)}
        </div>
      </div>
      <div className="flex justify-between text-xs font-semibold text-mute">
        <span>30 дней назад</span>
        <span>сегодня</span>
      </div>
    </li>
  );
}

function Banner({ servers }: { servers: StatusServer[] }) {
  const total = servers.length;
  const up = servers.filter((s) => s.online).length;
  const [cls, title] = up === total
    ? ['bg-okbg text-ok', 'Все серверы работают']
    : up === 0
      ? ['bg-badbg text-bad', 'Все серверы недоступны']
      : ['bg-warnbg text-warn', 'Часть серверов недоступна'];
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-3xl px-5 py-4 ${cls}`} role="status">
      <span className="text-xl font-black">{title}</span>
      <span className="font-bold">онлайн: {up} из {total}</span>
    </div>
  );
}

const LEGEND: [string, string][] = [
  ['bg-ok', '99,9% и выше'],
  ['bg-ok/60', 'от 95%'],
  ['bg-warn', 'от 80%'],
  ['bg-bad', 'ниже 80%'],
  ['bg-line', 'нет данных'],
];

/** Public status page: every server with its 30-day availability. */
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
      <PageHead icon={<IconServers />} title="Статус" subtitle="Доступность серверов за последние 30 дней" />
      {error && !data ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}

      {!data && !error && (
        <div className="space-y-3" aria-busy="true" aria-label="Загрузка">
          <div className="skeleton panel h-16" />
          <div className="skeleton panel h-32" />
          <div className="skeleton panel h-32" />
        </div>
      )}

      {data && data.servers.length === 0 && (
        <Empty title="Серверов пока нет" text="Когда серверы будут добавлены, здесь появится их доступность." />
      )}

      {data && data.servers.length > 0 && (
        <div className="fade-in space-y-5">
          <Banner servers={data.servers} />
          <ul className="space-y-3">
            {data.servers.map((s) => <ServerRow key={s.id} s={s} />)}
          </ul>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold text-mute">
            {LEGEND.map(([c, t]) => (
              <span key={t} className="inline-flex items-center gap-1.5"><span className={`inline-block h-3 w-3 rounded-[3px] ${c}`} aria-hidden />{t}</span>
            ))}
            <span className="ml-auto">обновлено {ago(data.updatedAt)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
