import { useEffect, useState, type FormEvent } from 'react';
import { api, getToken, type BackupInfo, type BackupItem } from '../api';
import { confirmDialog, promptDialog } from '../confirm';
import { Button, ErrorLine, Field, Switch, fmtDateTime, toast } from '../ui';

export const fmtSize = (n: number) =>
  n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} ГБ` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : n >= 1024 ? `${Math.round(n / 1024)} КБ` : `${n} Б`;

const isEncrypted = (name: string) => name.endsWith('.enc');

/** save an authenticated GET as a file */
async function downloadFile(path: string, fallbackName: string) {
  const r = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Не удалось получить копию');
  const name = /filename="?([^"]+)"?/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** the panel restarts after a restore: wait until it is back, then reload (the old session may no longer be valid) */
async function waitAndReload() {
  for (let i = 0; i < 40; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    const ok = await fetch('/api/access').then((x) => x.ok).catch(() => false);
    if (ok && i > 1) break;
  }
  window.location.reload();
}

const askPassphrase = (what: string) =>
  promptDialog({
    title: 'Архив зашифрован',
    label: 'Парольная фраза',
    text: `Введите парольную фразу, с которой был создан архив «${what}».`,
    password: true,
    confirmLabel: 'Продолжить',
    validate: (v) => (v ? null : 'Введите парольную фразу'),
  });

/** Stored archives, schedule, off-site upload and restore. */
export default function BackupsCard() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const [schedule, setSchedule] = useState<BackupInfo['schedule']>('off');
  const [keep, setKeep] = useState(7);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [clearRemote, setClearRemote] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [clearPass, setClearPass] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () =>
    api<BackupInfo>('/backups')
      .then((r) => { setInfo(r); setSchedule(r.schedule); setKeep(r.keep); setError(''); })
      .catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const guard = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const downloadFull = () => guard('full', async () => {
    await downloadFile('/backup', 'coregsm-backup.tar.gz');
    toast('Копия скачана');
  });
  const createCopy = () => guard('run', async () => {
    await api<BackupItem>('/backups/run', 'POST');
    toast('Копия создана');
    await load();
  });
  const download = (b: BackupItem) => guard(`dl:${b.name}`, async () => {
    await downloadFile(`/backups/${encodeURIComponent(b.name)}`, b.name);
  });
  const remove = async (b: BackupItem) => {
    if (!(await confirmDialog({ title: 'Удалить копию?', text: `Файл «${b.name}» будет удалён с сервера без возможности восстановления.`, confirmLabel: 'Удалить', danger: true }))) return;
    await guard(`rm:${b.name}`, async () => {
      await api(`/backups/${encodeURIComponent(b.name)}`, 'DELETE');
      toast('Копия удалена');
      await load();
    });
  };
  const restoreStored = async (b: BackupItem) => {
    if (!(await confirmDialog({
      title: 'Восстановить из этой копии?',
      text: `Все текущие данные панели будут заменены копией «${b.name}» от ${fmtDateTime(b.createdAt)}. Текущая база будет сохранена на сервере как coregsm.db.before-restore. Панель перезапустится.`,
      confirmLabel: 'Восстановить',
      danger: true,
    }))) return;
    let pass: string | undefined;
    if (isEncrypted(b.name)) {
      const p = await askPassphrase(b.name);
      if (p == null) return;
      pass = p;
    }
    setRestoring(true);
    setError('');
    try {
      await api('/backups/' + encodeURIComponent(b.name) + '/restore', 'POST', pass ? { passphrase: pass } : {});
      toast('Копия принята, панель перезапускается…');
      await waitAndReload();
    } catch (e) {
      setError((e as Error).message);
      setRestoring(false);
    }
  };
  const restoreFile = async (file: File) => {
    if (!(await confirmDialog({
      title: 'Восстановить из файла?',
      text: `Все данные панели будут заменены копией «${file.name}». Текущая база будет сохранена на сервере как coregsm.db.before-restore. Панель перезапустится.`,
      confirmLabel: 'Восстановить',
      danger: true,
    }))) return;
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${getToken() ?? ''}` };
    if (file.name.endsWith('.enc')) {
      const p = await askPassphrase(file.name);
      if (p == null) return;
      // headers are Latin-1: send the passphrase percent-encoded
      headers['x-backup-passphrase'] = encodeURIComponent(p);
      headers['x-backup-passphrase-encoding'] = 'uri';
    }
    setRestoring(true);
    setError('');
    try {
      const r = await fetch('/api/backup/restore', { method: 'POST', headers, body: file });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(j?.error ?? 'Не удалось восстановить копию');
      toast('Копия принята, панель перезапускается…');
      await waitAndReload();
    } catch (e) {
      setError((e as Error).message);
      setRestoring(false);
    }
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const url = remoteUrl.trim();
    if (url && !/^https:\/\//i.test(url)) { setError('Адрес для отправки должен начинаться с https://'); return; }
    if (!Number.isInteger(keep) || keep < 1 || keep > 30) { setError('Хранить можно от 1 до 30 копий'); return; }
    const body: { schedule: string; keep: number; remoteUrl?: string; passphrase?: string } = { schedule, keep };
    if (clearRemote) body.remoteUrl = '';
    else if (url) body.remoteUrl = url;
    if (clearPass) body.passphrase = '';
    else if (passphrase) body.passphrase = passphrase;
    setSaving(true);
    try {
      await api('/backups/settings', 'PUT', body);
      setRemoteUrl('');
      setClearRemote(false);
      setPassphrase('');
      setClearPass(false);
      toast('Настройки копий сохранены');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const disabled = restoring || busy != null;

  return (
    <div className="panel space-y-5 p-6">
      <div>
        <h2 className="text-lg font-black">Резервные копии</h2>
        <p className="font-semibold text-mute">
          В копию входят база (серверы, привязки, пользователи, новости, настройки), картинки новостей и логотип.
          Внутри хранятся секреты: токен бота и хэши паролей. Храните файлы так же бережно, как пароль, лучше зашифрованными.
        </p>
      </div>
      <ErrorLine text={error} />

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" onClick={() => void downloadFull()} disabled={disabled}>{busy === 'full' ? 'Готовлю…' : 'Скачать полную копию'}</button>
        <button className="btn btn-soft" onClick={() => void createCopy()} disabled={disabled}>{busy === 'run' ? 'Создаю…' : 'Создать копию на сервере'}</button>
        <label className={`btn btn-soft cursor-pointer ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
          {restoring ? 'Восстанавливаю…' : 'Восстановить из файла'}
          <input
            type="file"
            accept=".db,.gz,.enc,.tar.gz,application/octet-stream"
            className="hidden"
            disabled={disabled}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restoreFile(f); }}
          />
        </label>
      </div>

      <form onSubmit={saveSettings} className="space-y-4 rounded-2xl bg-soft p-4">
        <h3 className="font-black">Расписание и хранение</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Автоматические копии">
            <select id="bk-schedule" className="input" value={schedule} onChange={(e) => setSchedule(e.target.value as BackupInfo['schedule'])}>
              <option value="off">Выключено</option>
              <option value="daily">Каждый день</option>
              <option value="weekly">Каждую неделю</option>
            </select>
          </Field>
          <Field label="Сколько копий хранить (1-30)">
            <input id="bk-keep" className="input" type="number" min={1} max={30} value={keep} onChange={(e) => setKeep(Number(e.target.value))} />
          </Field>
        </div>

        <div>
          <label htmlFor="bk-remote" className="label">Отправлять копию по адресу (необязательно)</label>
          <input
            id="bk-remote"
            className="input font-mono"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={clearRemote ? '' : remoteUrl}
            disabled={clearRemote}
            onChange={(e) => setRemoteUrl(e.target.value)}
            placeholder={info?.remoteUrl ? `сейчас: ${info.remoteUrl}` : 'https://…'}
            aria-describedby="bk-remote-hint"
          />
          <p id="bk-remote-hint" className="mt-1.5 text-sm font-semibold text-mute">Адрес должен начинаться с https://. Копия отправляется методом PUT, подходит для WebDAV/Nextcloud и подписанных ссылок S3.</p>
          {info?.remoteUrl && (
            <label className="mt-2 flex items-center gap-3 text-sm font-bold text-mute">
              <Switch checked={clearRemote} onChange={setClearRemote} />
              Отключить отправку
            </label>
          )}
          {info?.lastRemote && (
            <p className={`mt-2 rounded-2xl px-4 py-2 text-sm font-bold ${info.lastRemote.ok ? 'bg-okbg text-ok' : 'bg-badbg text-bad'}`} role="status">
              Последняя отправка: {fmtDateTime(info.lastRemote.at)}, {info.lastRemote.ok ? 'успешно' : `ошибка${info.lastRemote.error ? `: ${info.lastRemote.error}` : ''}`}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="bk-pass" className="label">Парольная фраза для шифрования (необязательно)</label>
          <input
            id="bk-pass"
            className="input"
            type="password"
            autoComplete="new-password"
            value={clearPass ? '' : passphrase}
            disabled={clearPass}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder={info?.encrypted ? 'шифрование включено, введите новую фразу для замены' : 'не задана: копии не шифруются'}
            aria-describedby="bk-pass-hint"
          />
          <p id="bk-pass-hint" className="mt-1.5 text-sm font-bold text-warn">Если потерять парольную фразу, зашифрованные архивы нельзя будет прочитать. Восстановить её невозможно.</p>
          {info?.encrypted && (
            <label className="mt-2 flex items-center gap-3 text-sm font-bold text-mute">
              <Switch checked={clearPass} onChange={setClearPass} />
              Отключить шифрование новых копий
            </label>
          )}
        </div>

        <Button loading={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}</Button>
      </form>

      <div>
        <h3 className="mb-2 font-black">Копии на сервере</h3>
        {!info ? (
          <div className="skeleton h-20 rounded-2xl" />
        ) : info.items.length === 0 ? (
          <p className="font-semibold text-mute">Пока нет сохранённых копий. Нажмите «Создать копию на сервере» или включите расписание.</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {info.items.map((b) => (
              <li key={b.name} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="break-all font-mono text-sm font-bold">{b.name}</div>
                  <div className="text-sm font-semibold text-mute">{fmtDateTime(b.createdAt)} · {fmtSize(b.size)}</div>
                </div>
                <span className={`pill ${b.kind === 'auto' ? 'pill-mute' : 'pill-ok'}`}>{b.kind === 'auto' ? 'АВТО' : 'ВРУЧНУЮ'}</span>
                {isEncrypted(b.name) && <span className="pill pill-warn">ЗАШИФРОВАНА</span>}
                <div className="flex gap-2">
                  <button className="btn btn-soft btn-sm" onClick={() => void download(b)} disabled={disabled}>Скачать</button>
                  <button className="btn btn-soft btn-sm" onClick={() => void restoreStored(b)} disabled={disabled}>Восстановить</button>
                  <button className="btn btn-danger btn-sm" onClick={() => void remove(b)} disabled={disabled}>Удалить</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
