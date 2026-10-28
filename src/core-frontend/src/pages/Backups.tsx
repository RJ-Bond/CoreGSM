import { useEffect, useState, type FormEvent } from 'react';
import { api, getToken, type BackupInfo, type BackupItem } from '../api';
import { confirmDialog, promptDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { loadUnreadableSecrets, saveUnreadableSecrets, unreadableSecrets } from '../security';
import { Button, ErrorLine, Field, IconDownload, LoadError, StateView, IconRestore, IconTrash, Section, Switch, fmtDateTime, ago, toast, errText } from '../ui';
import { errorText } from '../apiErrors';
import { BackupS3 } from '../components/BackupS3';

/** the copies on a time line: a bar per copy (the height is its size, the colour is auto / manual), and how old the last one is */
function BackupTimeline({ items, schedule }: { items: BackupInfo['items']; schedule: BackupInfo['schedule'] }) {
  useI18n();
  const list = [...items].sort((a, b) => a.createdAt - b.createdAt).slice(-30);
  const max = Math.max(1, ...list.map((b) => b.size));
  const total = items.reduce((n, b) => n + b.size, 0);
  const last = list[list.length - 1];
  const ageH = (Date.now() - last.createdAt) / 3_600_000;
  // an automatic schedule that has not produced a copy for twice its period is worth a warning
  const late = schedule !== 'off' && ageH > (schedule === 'daily' ? 48 : 24 * 14);
  return (
    <div className="mb-3 space-y-2 rounded-ui-lg bg-soft p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm font-bold text-mute">
        <span><b className="text-ink">{items.length}</b> {t('d2.bk.copies', { n: items.length })}, {t('d2.bk.total', { size: fmtSize(total) })}</span>
        <span className={late ? 'text-warn' : ''}>{t('d2.bk.last', { ago: ago(last.createdAt) })}{late ? `. ${t('d2.bk.late')}` : ''}</span>
      </div>
      <div className="bk-line" role="img" aria-label={t('d2.bk.countLabel', { n: items.length })}>
        {list.map((b) => (
          <span key={b.name} className={b.kind === 'auto' ? '' : 'is-manual'} style={{ height: `${Math.max(12, (b.size / max) * 100)}%` }} title={`${fmtDateTime(b.createdAt)} · ${fmtSize(b.size)} · ${b.kind === 'auto' ? t('d2.bk.auto') : t('d2.bk.manual')}`} />
        ))}
      </div>
      <div className="flex justify-between text-xs font-bold text-mute"><span>{fmtDateTime(list[0].createdAt)}</span><span>{fmtDateTime(last.createdAt)}</span></div>
    </div>
  );
}

export const fmtSize = (n: number) =>
  n >= 1073741824 ? t('d2.sys.gb', { v: (n / 1073741824).toFixed(1) }) : n >= 1048576 ? t('d2.sys.mb', { v: (n / 1048576).toFixed(1) }) : n >= 1024 ? t('d2.bk.kb', { v: Math.round(n / 1024) }) : t('d2.bk.b', { v: n });

const isEncrypted = (name: string) => name.endsWith('.enc');

/** save an authenticated GET as a file */
export async function downloadFile(path: string, fallbackName: string) {
  const r = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
  if (!r.ok) throw new Error(errorText(await r.json().catch(() => null), t('d2.bk.getFail')));
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
    title: t('d2.bk.encTitle'),
    label: t('d2.bk.pass'),
    text: t('d2.bk.encText', { what }),
    password: true,
    confirmLabel: t('d2.bk.continue'),
    validate: (v) => (v ? null : t('d2.bk.passEnter')),
  });

/** Stored archives, schedule, off-site upload and restore. */
export default function BackupsCard() {
  useI18n();
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  // secrets that the restored copy could not decrypt: the warning stays until it is dismissed (and across the reload)
  const [unreadable, setUnreadable] = useState<string[]>(() => loadUnreadableSecrets());

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
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };

  const downloadFull = () => guard('full', async () => {
    await downloadFile('/backup', 'coregsm-backup.tar.gz');
    toast(t('d2.bk.t.downloaded'));
  });
  const createCopy = () => guard('run', async () => {
    await api<BackupItem>('/backups/run', 'POST');
    toast(t('d2.bk.t.created'));
    await load();
  });
  const download = (b: BackupItem) => guard(`dl:${b.name}`, async () => {
    await downloadFile(`/backups/${encodeURIComponent(b.name)}`, b.name);
  });
  const remove = async (b: BackupItem) => {
    if (!(await confirmDialog({ title: t('d2.bk.c.delTitle'), text: t('d2.bk.c.delText', { name: b.name }), confirmLabel: t('d2.news.delete'), danger: true }))) return;
    await guard(`rm:${b.name}`, async () => {
      await api(`/backups/${encodeURIComponent(b.name)}`, 'DELETE');
      toast(t('d2.bk.t.deleted'));
      await load();
    });
  };
  /** after a restore: with unreadable secrets the page stays (and warns), otherwise it waits for the restart and reloads */
  const afterRestore = async (raw: unknown) => {
    const un = unreadableSecrets(raw).map((x) => x.id);
    toast(t('d2.bk.t.accepted'));
    if (un.length) {
      saveUnreadableSecrets(un);
      setUnreadable(un);
      setRestoring(false);
      return;
    }
    await waitAndReload();
  };
  const restoreStored = async (b: BackupItem) => {
    if (!(await confirmDialog({
      title: t('d2.bk.c.restoreTitle'),
      text: t('d2.bk.c.restoreText', { name: b.name, when: fmtDateTime(b.createdAt) }),
      confirmLabel: t('d2.bk.restore'),
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
      const r = await api<{ unreadableSecrets?: string[] }>('/backups/' + encodeURIComponent(b.name) + '/restore', 'POST', pass ? { passphrase: pass } : {});
      await afterRestore(r?.unreadableSecrets);
    } catch (e) {
      setError(errText(e));
      setRestoring(false);
    }
  };
  const restoreFile = async (file: File) => {
    if (!(await confirmDialog({
      title: t('d2.bk.c.fileTitle'),
      text: t('d2.bk.c.fileText', { name: file.name }),
      confirmLabel: t('d2.bk.restore'),
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
      const j = (await r.json().catch(() => null)) as { error?: string; unreadableSecrets?: string[] } | null;
      if (!r.ok) throw new Error(errorText(j, t('d2.bk.restoreFail')));
      await afterRestore(j?.unreadableSecrets);
    } catch (e) {
      setError(errText(e));
      setRestoring(false);
    }
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const url = remoteUrl.trim();
    if (url && !/^https:\/\//i.test(url)) { setError(t('d2.bk.e.https')); return; }
    if (!Number.isInteger(keep) || keep < 1 || keep > 30) { setError(t('d2.bk.e.keep')); return; }
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
      toast(t('d2.bk.t.settings'));
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  const disabled = restoring || busy != null;

  return (
    <Section
      title={t('d2.sys.backups')}
      description={t('d2.bk.desc')}
    >
      {error && !info ? <LoadError error={error} onRetry={() => void load()} compact bare /> : <ErrorLine text={error} />}

      {unreadable.length > 0 && (
        <div className="space-y-3 rounded-ui-lg bg-warnbg p-4 text-warn" role="alert">
          <h3 className="font-black">{t('bk.unreadTitle')}</h3>
          <p className="font-semibold">{t('bk.unreadText')}</p>
          <ul className="list-disc space-y-0.5 pl-5 font-bold">
            {unreadableSecrets(unreadable).map((x) => <li key={x.id}>{x.label}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-sm" href="/admin/settings">{t('bk.unreadSettings')}</a>
            <button type="button" className="btn btn-soft btn-sm" onClick={() => void waitAndReload()}>{t('bk.unreadReload')}</button>
            <button type="button" className="btn btn-soft btn-sm" onClick={() => { saveUnreadableSecrets([]); setUnreadable([]); }}>{t('bk.unreadDismiss')}</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" onClick={() => void downloadFull()} disabled={disabled}>{busy === 'full' ? t('d2.bk.preparing') : t('d2.bk.full')}</button>
        <button className="btn btn-soft" onClick={() => void createCopy()} disabled={disabled}>{busy === 'run' ? t('d2.bk.creating') : t('d2.bk.create')}</button>
        <label className={`btn btn-soft cursor-pointer ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
          {restoring ? t('d2.bk.restoring') : t('d2.bk.fromFile')}
          <input
            type="file"
            accept=".db,.gz,.enc,.tar.gz,application/octet-stream"
            className="hidden"
            disabled={disabled}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restoreFile(f); }}
          />
        </label>
      </div>

      <form onSubmit={saveSettings} className="space-y-4 rounded-ui-lg bg-soft p-4">
        <h3 className="font-black">{t('d2.bk.schedule')}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('d2.bk.auto2')}>
            <select id="bk-schedule" className="input" value={schedule} onChange={(e) => setSchedule(e.target.value as BackupInfo['schedule'])}>
              <option value="off">{t('al.smart.off')}</option>
              <option value="daily">{t('d2.bk.everyDay')}</option>
              <option value="weekly">{t('d2.mt.weekly')}</option>
            </select>
          </Field>
          <Field label={t('d2.bk.keep')}>
            <input id="bk-keep" className="input" type="number" min={1} max={30} value={keep} onChange={(e) => setKeep(Number(e.target.value))} />
          </Field>
        </div>

        <div>
          <label htmlFor="bk-remote" className="label">{t('d2.bk.remote')}</label>
          <input
            id="bk-remote"
            className="input font-mono"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={clearRemote ? '' : remoteUrl}
            disabled={clearRemote}
            onChange={(e) => setRemoteUrl(e.target.value)}
            placeholder={info?.remoteUrl ? t('d2.bot.proxyNow', { url: info.remoteUrl }) : 'https://…'}
            aria-describedby="bk-remote-hint"
          />
          <p id="bk-remote-hint" className="mt-1.5 text-sm font-semibold text-mute">{t('d2.bk.remoteHint')}</p>
          {info?.remoteUrl && (
            <label className="mt-2 flex items-center gap-3 text-sm font-bold text-mute">
              <Switch checked={clearRemote} onChange={setClearRemote} />
              {t('d2.bk.remoteOff')}
            </label>
          )}
          {info?.lastRemote && (
            <p className={`mt-2 rounded-2xl px-4 py-2 text-sm font-bold ${info.lastRemote.ok ? 'bg-okbg text-ok' : 'bg-badbg text-bad'}`} role="status">
              {t('d2.bk.lastSend')} {fmtDateTime(info.lastRemote.at)}, {info.lastRemote.ok ? t('d2.bk.ok') : `${t('d2.sys.bot.error')}${info.lastRemote.error ? `: ${info.lastRemote.error}` : ''}`}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="bk-pass" className="label">{t('d2.bk.passLabel')}</label>
          <input
            id="bk-pass"
            className="input"
            type="password"
            autoComplete="new-password"
            value={clearPass ? '' : passphrase}
            disabled={clearPass}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder={info?.encrypted ? t('d2.bk.passOn') : t('d2.bk.passOff')}
            aria-describedby="bk-pass-hint"
          />
          <p id="bk-pass-hint" className="mt-1.5 text-sm font-bold text-warn">{t('d2.bk.passWarn')}</p>
          {info?.encrypted && (
            <label className="mt-2 flex items-center gap-3 text-sm font-bold text-mute">
              <Switch checked={clearPass} onChange={setClearPass} />
              {t('d2.bk.encOff')}
            </label>
          )}
        </div>

        <Button loading={saving}>{saving ? t('d2.sf.saving') : t('common.save')}</Button>
      </form>

      <BackupS3 info={info} reload={load} />

      <div>
        <h3 className="mb-2 font-black">{t('d2.bk.onServer')}</h3>
        {info && info.items.length > 0 && <BackupTimeline items={info.items} schedule={info.schedule} />}
        {!info ? (
          <div className="skeleton h-20 rounded-2xl" />
        ) : info.items.length === 0 ? (
          <StateView kind="empty" compact bare title={t('d2.bk.empty')} text={t('d2.bk.emptyText')} className="rounded-2xl bg-soft" />
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {info.items.map((b) => (
              <li key={b.name} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="break-all font-mono text-sm font-bold">{b.name}</div>
                  <div className="text-sm font-semibold text-mute">{fmtDateTime(b.createdAt)} · {fmtSize(b.size)}</div>
                </div>
                <span className={`pill ${b.kind === 'auto' ? 'pill-mute' : 'pill-ok'}`}>{b.kind === 'auto' ? t('d2.bk.autoU') : t('d2.bk.manualU')}</span>
                {isEncrypted(b.name) && <span className="pill pill-warn">{t('d2.bk.encrypted')}</span>}
                <div className="flex items-center gap-1.5" role="group" aria-label={t('d2.bk.actions', { name: b.name })}>
                  <button type="button" className="row-act" title={t('cards.download')} aria-label={t('cards.download')} onClick={() => void download(b)} disabled={disabled}><IconDownload /></button>
                  <button type="button" className="row-act" title={t('d2.bk.c.restoreTitle')} aria-label={t('d2.bk.c.restoreTitle')} onClick={() => void restoreStored(b)} disabled={disabled}><IconRestore /></button>
                  <button type="button" className="row-act row-act-danger" title={t('d2.news.delete')} aria-label={t('d2.news.delete')} onClick={() => void remove(b)} disabled={disabled}><IconTrash /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
