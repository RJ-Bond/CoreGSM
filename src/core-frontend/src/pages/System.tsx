import { useMemo, useState } from 'react';
import { api, type CertInfo } from '../api';
import { Gauge, usageTone, type GaugeTone } from '../components/Gauge';
import HealthHistoryCard, { type HealthFlag } from '../components/HealthHistoryCard';
import { AdminPage, ErrorLine, GoLink, LoadError, IconDatabase, IconDisk, IconMemory, IconSystem, Notice, PageHead, Section, Strip, ago, fmtDateTime, fmtTime, plural, usePoll } from '../ui';

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
  flags?: HealthFlag[];
}
interface Check { id: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string }

const mb = (n: number | null) => (n == null ? '–' : n > 1073741824 ? `${(n / 1073741824).toFixed(1)} ГБ` : `${(n / 1048576).toFixed(1)} МБ`);
const dur = (s: number) => (s < 3600 ? `${Math.floor(s / 60)} мин` : s < 86400 ? `${Math.floor(s / 3600)} ч ${Math.floor((s % 3600) / 60)} мин` : `${Math.floor(s / 86400)} д ${Math.floor((s % 86400) / 3600)} ч`);

// the backend reports the process memory and the database file only, so they are drawn against a fixed reference size
const MEM_REF_MB = 512;
const DB_REF_BYTES = 1024 * 1048576;

const certTone = (c: CertInfo): GaugeTone => (c.daysLeft == null ? 'mute' : c.daysLeft <= 0 ? 'bad' : c.daysLeft <= 14 ? 'warn' : 'ok');
const certText = (c: CertInfo) => {
  if (c.daysLeft == null) return 'нет (панель работает по HTTP)';
  const d = c.daysLeft;
  return d <= 0 ? 'истёк' : `${d} ${plural(d, ['день', 'дня', 'дней'])}`;
};

/** Health, diagnostics and the certificate; the backups live under Settings → «Обновления и копии». */
export default function SystemPage() {
  const [h, setH] = useState<Health | null>(null);
  const [checks, setChecks] = useState<{ at: number; list: Check[] } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [histFlags, setHistFlags] = useState<HealthFlag[]>([]);

  const load = () => api<Health>('/system').then((r) => { setH(r); setError(''); }).catch((e: Error) => setError(e.message));
  usePoll(load, 15_000);

  const run = async () => {
    setRunning(true);
    await api<{ at: number; checks: Check[] }>('/system/run', 'POST').then((r) => setChecks({ at: r.at, list: r.checks })).catch((e: Error) => setError(e.message));
    setRunning(false);
  };

  // warnings from /system and from the history, one per kind (the earliest «с» wins)
  const flags = useMemo(() => {
    const m = new Map<string, HealthFlag>();
    for (const f of [...(h?.flags ?? []), ...histFlags]) {
      const old = m.get(f.kind);
      if (!old || f.since < old.since) m.set(f.kind, f);
    }
    return [...m.values()].sort((a, b) => a.since - b.since);
  }, [h, histFlags]);

  const diskUsed = h && h.diskTotal && h.diskFree != null ? 1 - h.diskFree / h.diskTotal : null;
  const memFrac = h ? h.memoryMb / MEM_REF_MB : null;
  const dbFrac = h && h.dbBytes != null ? h.dbBytes / DB_REF_BYTES : null;

  const botTone: GaugeTone = !h ? 'mute' : h.bot.state === 'online' ? 'ok' : h.bot.state === 'connecting' ? 'warn' : h.bot.state === 'error' ? 'bad' : 'mute';
  const status: { k: string; v: string; sub?: string; tone: GaugeTone }[] = h
    ? [
        { k: 'Версия', v: h.version ? h.version.slice(0, 7) : 'не задана', sub: `Node ${h.node}`, tone: 'mute' },
        { k: 'Работает', v: dur(h.uptimeSec), tone: 'ok' },
        { k: 'Серверы', v: `${h.counts.online} из ${h.counts.servers} онлайн`, tone: h.counts.servers === 0 ? 'mute' : h.counts.online === h.counts.servers ? 'ok' : h.counts.online === 0 ? 'bad' : 'warn' },
        { k: 'Привязки Discord', v: String(h.counts.bindings), sub: `${h.guilds} ${plural(h.guilds, ['сервер', 'сервера', 'серверов'])} с ботом`, tone: 'mute' },
        { k: 'Бот', v: h.bot.state === 'online' ? 'в сети' : h.bot.state === 'idle' ? 'ожидание' : h.bot.state === 'connecting' ? 'подключается' : 'ошибка', sub: h.bot.tag ?? (h.bot.updatedAt ? ago(h.bot.updatedAt) : undefined), tone: botTone },
        ...(h.cert ? [{ k: 'Сертификат HTTPS', v: certText(h.cert), sub: [h.cert.issuer, h.cert.selfSigned ? 'самоподписанный' : null].filter(Boolean).join(' · ') || undefined, tone: certTone(h.cert) }] : []),
        { k: 'Пользователи', v: String(h.counts.users), tone: 'mute' as GaugeTone },
      ]
    : [];
  const dot = { ok: 'dot-ok', warn: 'dot-warn', fail: 'dot-bad' } as const;

  return (
    <AdminPage
      head={(
        <PageHead
          icon={<IconSystem />}
          title="Система"
          subtitle="Состояние панели и диагностика"
          hint="Здоровье панели: версия, место на диске, бот, сертификат HTTPS. Если что-то не работает, начните с проверки."
          help={<p>Проверка занимает несколько секунд: она смотрит базу, диск, подключение бота, опрос серверов и доступ к Discord и GitHub. Зелёная точка значит, что всё в порядке, жёлтая — стоит присмотреться, красная — нужно исправить.</p>}
        >
          <button className="btn" onClick={run} disabled={running}>{running ? 'Проверяю…' : 'Запустить проверку'}</button>
        </PageHead>
      )}
    >
      {error && !h ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}

      {flags.length > 0 && (
        <div className="space-y-2" role="group" aria-label="Предупреждения">
          {flags.map((f) => (
            <Notice key={f.kind} tone="warn">
              {f.text}<span className="font-semibold opacity-80"> · с {new Date(f.since).toDateString() === new Date().toDateString() ? fmtTime(f.since) : fmtDateTime(f.since)}</span>
            </Notice>
          ))}
        </div>
      )}

      {h ? (
        <>
          <div className="grid grid-cols-1 gap-4 min-[460px]:grid-cols-3" role="group" aria-label="Ресурсы">
            <div className="panel p-5 text-center">
              <Gauge
                value={diskUsed}
                label="Диск: занято"
                display={diskUsed == null ? '–' : `${Math.round(diskUsed * 100)} %`}
                caption={h.diskFree != null ? `свободно ${mb(h.diskFree)}` : undefined}
                icon={<IconDisk size={18} />}
              />
              <div className="mt-2 font-extrabold">Диск</div>
              <div className="text-sm font-semibold text-mute">{h.diskTotal ? `всего ${mb(h.diskTotal)}` : 'размер неизвестен'}</div>
            </div>
            <div className="panel p-5 text-center">
              <Gauge value={memFrac} tone={usageTone(memFrac)} label="Память панели" display={`${h.memoryMb} МБ`} caption={`из ${MEM_REF_MB} МБ`} icon={<IconMemory size={18} />} />
              <div className="mt-2 font-extrabold">Память</div>
              <div className="text-sm font-semibold text-mute">процесс панели, ориентир {MEM_REF_MB} МБ</div>
            </div>
            <div className="panel p-5 text-center">
              <Gauge value={dbFrac} tone={usageTone(dbFrac)} label="База данных" display={mb(h.dbBytes)} caption="ориентир 1 ГБ" icon={<IconDatabase size={18} />} />
              <div className="mt-2 font-extrabold">База данных</div>
              <div className="text-sm font-semibold text-mute">{h.counts.history.toLocaleString('ru-RU')} точек истории</div>
            </div>
          </div>

          <Section title="Состояние">
            <ul className="divide-y divide-line">
              {status.map((r) => (
                <li key={r.k} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5">
                  <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full dot-${r.tone}`} />
                  <span className="font-extrabold">{r.k}</span>
                  {r.sub && <span className="min-w-0 break-words text-sm font-semibold text-mute">{r.sub}</span>}
                  <span className={`ml-auto font-black tabular-nums ${r.tone === 'bad' ? 'text-bad' : r.tone === 'warn' ? 'text-warn' : ''}`}>{r.v}</span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      ) : (
        <div className="skeleton panel h-40" aria-busy="true" aria-label="Загрузка" />
      )}

      <HealthHistoryCard onFlags={setHistFlags} />

      <Section title="Диагностика" description="Проверяет базу, диск, бота, опрос серверов и доступ к Discord и GitHub.">
        {!checks && <p className="text-sm font-semibold text-mute">Нажмите «Запустить проверку» вверху страницы: результат появится здесь.</p>}
        {checks && (
          <>
            <ul className="divide-y divide-line rounded-ui-lg border border-line">
              {checks.list.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot[c.status]}`} role="img" aria-label={c.status === 'ok' ? 'в порядке' : c.status === 'warn' ? 'внимание' : 'ошибка'} />
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
      </Section>

      <Strip>
        <div className="min-w-0">
          <h2 className="text-lg font-black">Резервные копии</h2>
          <p className="font-semibold text-mute">Скачать копию данных, настроить расписание или восстановить панель из файла.</p>
        </div>
        <GoLink href="/admin/settings/updates">Обновления и копии</GoLink>
      </Strip>
    </AdminPage>
  );
}
