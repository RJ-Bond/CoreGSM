import { useState } from 'react';
import { api, type CertInfo } from '../api';
import { ErrorLine, GoLink, IconSystem, PageHead, ago, fmtDateTime, plural, usePoll } from '../ui';

interface Health {
  version: string | null;
  uptimeSec: number;
  node: string;
  dbBytes: number | null;
  diskFree: number | null;
  diskTotal: number | null;
  memoryMb: number;
  counts: { servers: number; online: number; bindings: number; users: number; history: number };
  bot: { state: string; tag: string | null; error: string | null; updatedAt: number };
  guilds: number;
  publicBase: string | null;
  cert?: CertInfo;
}
interface Check { id: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string }

const mb = (n: number | null) => (n == null ? '–' : n > 1073741824 ? `${(n / 1073741824).toFixed(1)} ГБ` : `${(n / 1048576).toFixed(1)} МБ`);
const dur = (s: number) => (s < 3600 ? `${Math.floor(s / 60)} мин` : s < 86400 ? `${Math.floor(s / 3600)} ч ${Math.floor((s % 3600) / 60)} мин` : `${Math.floor(s / 86400)} д ${Math.floor((s % 86400) / 3600)} ч`);

const certTile = (c: CertInfo): [string, string, string | undefined, string | undefined] => {
  const note = [c.issuer, c.selfSigned ? 'самоподписанный' : null].filter(Boolean).join(' · ') || undefined;
  if (c.daysLeft == null) return ['Сертификат HTTPS', 'нет', note ?? 'панель работает по HTTP', undefined];
  const d = c.daysLeft;
  const value = d <= 0 ? 'истёк' : `${d} ${plural(d, ['день', 'дня', 'дней'])}`;
  const tone = d <= 0 ? 'text-bad' : d <= 14 ? 'text-warn' : undefined;
  return ['Сертификат HTTPS', value, note, tone];
};

/** Health, diagnostics and the certificate; the backups live under Settings → «Обновления и копии». */
export default function SystemPage() {
  const [h, setH] = useState<Health | null>(null);
  const [checks, setChecks] = useState<{ at: number; list: Check[] } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  usePoll(() => api<Health>('/system').then((r) => { setH(r); setError(''); }).catch((e: Error) => setError(e.message)), 15_000);

  const run = async () => {
    setRunning(true);
    await api<{ at: number; checks: Check[] }>('/system/run', 'POST').then((r) => setChecks({ at: r.at, list: r.checks })).catch((e: Error) => setError(e.message));
    setRunning(false);
  };

  const tiles: [string, string, string?, string?][] = h
    ? [
        ['Версия', h.version ? h.version.slice(0, 7) : 'не задана', `Node ${h.node}`],
        ['Работает', dur(h.uptimeSec), `память ${h.memoryMb} МБ`],
        ['База данных', mb(h.dbBytes), `${h.counts.history.toLocaleString('ru-RU')} точек истории`],
        ['Свободно на диске', mb(h.diskFree), h.diskTotal ? `из ${mb(h.diskTotal)}` : undefined],
        ['Серверы', `${h.counts.online} из ${h.counts.servers}`, 'онлайн'],
        ['Привязки Discord', String(h.counts.bindings), `${h.guilds} ${plural(h.guilds, ['сервер', 'сервера', 'серверов'])} с ботом`],
        ['Пользователи', String(h.counts.users)],
        ...(h.cert ? [certTile(h.cert)] : []),
        ['Бот', h.bot.state === 'online' ? 'в сети' : h.bot.state === 'idle' ? 'ожидание' : h.bot.state === 'connecting' ? 'подключается' : 'ошибка', h.bot.tag ?? (h.bot.updatedAt ? ago(h.bot.updatedAt) : undefined)],
      ]
    : [];
  const dot = { ok: 'bg-ok', warn: 'bg-warn', fail: 'bg-bad' } as const;

  return (
    <div className="space-y-5">
      <PageHead
        icon={<IconSystem />}
        title="Система"
        subtitle="Состояние панели и диагностика"
        hint="Здоровье панели: версия, место на диске, бот, сертификат HTTPS. Если что-то не работает, начните с проверки."
        help={<p>Проверка занимает несколько секунд: она смотрит базу, диск, подключение бота, опрос серверов и доступ к Discord и GitHub. Зелёная точка значит, что всё в порядке, жёлтая — стоит присмотреться, красная — нужно исправить.</p>}
      >
        <button className="btn" onClick={run} disabled={running}>{running ? 'Проверяю…' : 'Запустить проверку'}</button>
      </PageHead>
      <ErrorLine text={error} />

      {h ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map(([k, v, hint, tone]) => (
            <div key={k} className="panel px-5 py-4">
              <div className="text-sm font-extrabold text-mute">{k}</div>
              <div className={`truncate text-2xl font-black tabular-nums ${tone ?? 'text-link'}`}>{v}</div>
              {hint && <div className="truncate text-sm font-semibold text-mute">{hint}</div>}
            </div>
          ))}
        </div>
      ) : (
        <div className="skeleton panel h-40" />
      )}

      <div className="panel space-y-4 p-6">
        <div>
          <h2 className="text-lg font-black">Диагностика</h2>
          <p className="font-semibold text-mute">Проверяет базу, диск, бота, опрос серверов и доступ к Discord и GitHub.</p>
        </div>
        {!checks && <p className="text-sm font-semibold text-mute">Нажмите «Запустить проверку» вверху страницы: результат появится здесь.</p>}
        {checks && (
          <>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {checks.list.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot[c.status]}`} aria-label={c.status} />
                  <div className="min-w-0">
                    <div className="font-extrabold">{c.label}</div>
                    <div className="break-words text-sm font-semibold text-mute">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-sm font-semibold text-mute">Проверено {fmtDateTime(checks.at)}</p>
          </>
        )}
      </div>

      <div className="panel flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-5">
        <div className="min-w-0">
          <h2 className="text-lg font-black">Резервные копии</h2>
          <p className="font-semibold text-mute">Скачать копию данных, настроить расписание или восстановить панель из файла.</p>
        </div>
        <GoLink href="#/admin/settings/updates">Обновления и копии</GoLink>
      </div>
    </div>
  );
}
