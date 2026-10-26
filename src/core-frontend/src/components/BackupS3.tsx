import { useState, type FormEvent } from 'react';
import { api, type BackupInfo } from '../api';
import { t } from '../i18n';
import { Button, ErrorLine, Field, Switch, fmtDateTime, toast, errText } from '../ui';

/** copies to an S3-compatible storage (AWS, Backblaze B2, Cloudflare R2, Wasabi, MinIO…): the keys are never shown again */
export function BackupS3({ info, reload }: { info: BackupInfo | null; reload: () => Promise<void> }) {
  const cur = info?.s3;
  const [endpoint, setEndpoint] = useState('');
  const [bucket, setBucket] = useState('');
  const [region, setRegion] = useState('');
  const [prefix, setPrefix] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [clear, setClear] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState('');
  const [test, setTest] = useState<{ ok: boolean; error: string | null } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy('save');
    try {
      if (clear) await api('/backups/settings', 'PUT', { s3Clear: true });
      else {
        await api('/backups/settings', 'PUT', {
          s3: { endpoint: endpoint.trim() || cur?.endpoint || '', bucket: bucket.trim() || cur?.bucket || '', region: region.trim() || cur?.region || '', prefix: prefix.trim() || cur?.prefix || '', accessKey, secretKey },
        });
      }
      setAccessKey('');
      setSecretKey('');
      setClear(false);
      setTest(null);
      toast(t('bk3.saved'));
      await reload();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    setError('');
    setBusy('test');
    try {
      setTest(await api<{ ok: boolean; error: string | null }>('/backups/test-s3', 'POST'));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-3 rounded-2xl border border-line p-4" aria-labelledby="bk3-title">
      <div>
        <h3 id="bk3-title" className="font-black">{t('bk3.title')}</h3>
        <p className="mt-1 text-sm font-semibold text-mute">{t('bk3.hint')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('bk3.endpoint')}>
          <input className="input font-mono" type="url" autoComplete="off" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder={cur?.endpoint || 'https://s3.eu-central-1.amazonaws.com'} />
        </Field>
        <Field label={t('bk3.bucket')}>
          <input className="input font-mono" autoComplete="off" value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder={cur?.bucket || 'my-backups'} />
        </Field>
        <Field label={t('bk3.region')}>
          <input className="input font-mono" autoComplete="off" value={region} onChange={(e) => setRegion(e.target.value)} placeholder={cur?.region || 'us-east-1'} />
        </Field>
        <Field label={t('bk3.prefix')}>
          <input className="input font-mono" autoComplete="off" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder={cur?.prefix || 'coregsm/'} />
        </Field>
        <Field label={t('bk3.accessKey')}>
          <input className="input font-mono" autoComplete="off" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} placeholder={cur?.configured ? t('bk3.kept') : ''} />
        </Field>
        <Field label={t('bk3.secretKey')}>
          <input className="input font-mono" type="password" autoComplete="new-password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={cur?.configured ? t('bk3.kept') : ''} />
        </Field>
      </div>
      {cur?.configured && (
        <label className="flex items-center gap-3 text-sm font-bold text-mute">
          <Switch checked={clear} onChange={setClear} />
          {t('bk3.off')}
        </label>
      )}
      {info?.lastS3 && (
        <p className={`rounded-2xl px-4 py-2 text-sm font-bold ${info.lastS3.ok ? 'bg-okbg text-ok' : 'bg-badbg text-bad'}`} role="status">
          {t('bk3.last', { at: fmtDateTime(info.lastS3.at) })} {info.lastS3.ok ? t('bk3.ok') : `${t('bk3.fail')}${info.lastS3.error ? `: ${info.lastS3.error}` : ''}`}
        </p>
      )}
      {test && (
        <p className={`rounded-2xl px-4 py-2 text-sm font-bold ${test.ok ? 'bg-okbg text-ok' : 'bg-badbg text-bad'}`} role="status">
          {test.ok ? t('bk3.testOk') : `${t('bk3.testFail')}${test.error ? `: ${test.error}` : ''}`}
        </p>
      )}
      <ErrorLine text={error} />
      <div className="flex flex-wrap gap-2">
        <Button loading={busy === 'save'}>{t('common.save')}</Button>
        {cur?.configured && <button type="button" className="btn btn-soft" onClick={() => void check()} disabled={busy != null}>{busy === 'test' ? t('bk3.testing') : t('bk3.test')}</button>}
      </div>
    </form>
  );
}
