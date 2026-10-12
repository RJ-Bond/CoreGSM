import { useState } from 'react';
import { api, getToken } from '../api';
import { ErrorLine, IconSettings, PageHead, ago, fmtDateTime, plural, toast, usePoll } from '../ui';

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
}
interface Check { id: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string }

const mb = (n: number | null) => (n == null ? '–' : n > 1073741824 ? `${(n / 1073741824).toFixed(1)} ГБ` : `${(n / 1048576).toFixed(1)} МБ`);
const dur = (s: number) => (s < 3600 ? `${Math.floor(s / 60)} мин` : s < 86400 ? `${Math.floor(s / 3600)} ч ${Math.floor((s % 3600) / 60)} мин` : `${Math.floor(s / 86400)} д ${Math.floor((s % 86400) / 3600)} ч`);

/** Health, diagnostics and backups. */
export default function SystemPage() {
  const [h, setH] = useState<Health | null>(null);
  const [checks, setChecks] = useState<{ at: number; list: Check[] } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(false);

  usePoll(() => api<Health>('/system').then((r) => { setH(r); setError(''); }).catch((e: Error) => setError(e.message)), 15_000);

  const run = async () => {
    setRunning(true);
    await api<{ at: number; checks: Check[] }>('/system/run', 'POST').then((r) => setChecks({ at: r.at, list: r.checks })).catch((e: Error) => setError(e.message));
    setRunning(false);
  };

  const download = async () => {
    try {
      const r = await fetch('/api/backup', { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
      if (!r.ok) throw new Error('Не удалось создать копию');
      const name = /filename="?([^"]+)"?/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'coregsm-backup.db';
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      toast('Копия скачана');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const restore = async (file: File) => {
    if (!window.confirm(`Заменить все данные панели копией «${file.name}»? Текущая база будет сохранена на сервере как coregsm.db.before-restore. Панель перезапустится.`)) return;
    setRestoring(true);
    setError('');
    try {
      const r = await fetch('/api/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${getToken() ?? ''}` }, body: file });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(j?.error ?? 'Не удалось восстановить копию');
      toast('Копия принята, панель перезапускается…');
      // wait until the backend is back, then reload (the old session may no longer be valid)
      for (let i = 0; i < 40; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        const ok = await fetch('/api/access').then((x) => x.ok).catch(() => false);
        if (ok && i > 1) break;
      }
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setRestoring(false);
    }
  };

  const tiles: [string, string, string?][] = h
    ? [
        ['Версия', h.version ? h.version.slice(0, 7) : 'не задана', `Node ${h.node}`],
        ['Работает', dur(h.uptimeSec), `память ${h.memoryMb} МБ`],
        ['База данных', mb(h.dbBytes), `${h.counts.history.toLocaleString('ru-RU')} точек истории`],
        ['Свободно на диске', mb(h.diskFree), h.diskTotal ? `из ${mb(h.diskTotal)}` : undefined],
        ['Серверы', `${h.counts.online} из ${h.counts.servers}`, 'онлайн'],
        ['Привязки Discord', String(h.counts.bindings), `${h.guilds} ${plural(h.guilds, ['сервер', 'сервера', 'серверов'])} с ботом`],
        ['Пользователи', String(h.counts.users)],
        ['Бот', h.bot.state === 'online' ? 'в сети' : h.bot.state === 'idle' ? 'ожидание' : h.bot.state === 'connecting' ? 'подключается' : 'ошибка', h.bot.tag ?? (h.bot.updatedAt ? ago(h.bot.updatedAt) : undefined)],
      ]
    : [];
  const dot = { ok: 'bg-ok', warn: 'bg-warn', fail: 'bg-bad' } as const;

  return (
    <div className="space-y-5">
      <PageHead icon={<IconSettings />} title="Система" subtitle="Состояние панели, диагностика и резервные копии" />
      <ErrorLine text={error} />

      {h ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map(([k, v, hint]) => (
            <div key={k} className="panel px-5 py-4">
              <div className="text-sm font-extrabold text-mute">{k}</div>
              <div className="truncate text-2xl font-black tabular-nums text-link">{v}</div>
              {hint && <div className="truncate text-sm font-semibold text-mute">{hint}</div>}
            </div>
          ))}
        </div>
      ) : (
        <div className="skeleton panel h-40" />
      )}

      <div className="panel space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">Диагностика</h2>
            <p className="font-semibold text-mute">Проверяет базу, диск, бота, опрос серверов и доступ к Discord и GitHub.</p>
          </div>
          <button className="btn" onClick={run} disabled={running}>{running ? 'Проверяю…' : 'Запустить проверку'}</button>
        </div>
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

      <div className="panel space-y-4 p-6">
        <div>
          <h2 className="text-lg font-black">Резервные копии</h2>
          <p className="font-semibold text-mute">
            В копию входят серверы, привязки, пользователи, новости и настройки, в том числе токен бота и хэши паролей. Храните файл так же бережно, как пароль.
            Картинки новостей и логотип в копию не входят.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" onClick={() => void download()}>Скачать копию</button>
          <label className={`btn btn-soft cursor-pointer ${restoring ? 'pointer-events-none opacity-50' : ''}`}>
            {restoring ? 'Восстанавливаю…' : 'Восстановить из файла'}
            <input type="file" accept=".db,application/octet-stream" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void restore(f); e.target.value = ''; }} />
          </label>
        </div>
      </div>
    </div>
  );
}
