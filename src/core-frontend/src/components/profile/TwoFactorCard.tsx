/** Profile → Security: two-factor sign-in (TOTP) with one-time recovery codes. */
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { t } from '../../i18n';
import { Button, ErrorLine, PasswordField, toast } from '../../ui';

interface Status { enabled: boolean; recoveryLeft: number; hasPassword: boolean }
interface Setup { secret: string; uri: string }

const groups = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

export function TwoFactorCard() {
  const [st, setSt] = useState<Status | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setSt(await api<Status>('/auth/2fa')); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const reset = () => { setSetup(null); setDisabling(false); setCode(''); setPassword(''); setError(''); };

  const start = async () => {
    setError(''); setBusy(true);
    try { setSetup(await api<Setup>('/auth/2fa/setup', 'POST')); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const enable = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await api<{ recoveryCodes: string[] }>('/auth/2fa/enable', 'POST', { code: code.trim() });
      toast(t('pf.2fa.enabledToast'));
      reset();
      setCodes(r.recoveryCodes);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  const disable = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/auth/2fa/disable', 'POST', { code: code.trim(), ...(st?.hasPassword ? { password } : {}) });
      toast(t('pf.2fa.done'));
      reset();
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText((codes ?? []).join('\n')); toast(t('pf.2fa.copied')); } catch { /* the codes stay on screen */ }
  };

  if (!st) return <div className="panel p-6"><ErrorLine text={error} /></div>;

  if (codes) {
    return (
      <section className="panel space-y-3.5 p-6" aria-labelledby="pf-2fa-rec">
        <h2 id="pf-2fa-rec" className="text-lg font-black">{t('pf.2fa.recoveryTitle')}</h2>
        <p className="font-semibold text-mute">{t('pf.2fa.recoveryHint')}</p>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm font-bold">
          {codes.map((c) => <li key={c} className="rounded-xl bg-black/10 px-3 py-2 text-center select-all">{c}</li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline" onClick={() => void copy()}>{t('pf.2fa.copy')}</button>
          <button type="button" className="btn" onClick={() => setCodes(null)}>{t('pf.2fa.saved')}</button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel space-y-3.5 p-6" aria-labelledby="pf-2fa">
      <div className="flex items-center justify-between gap-3">
        <h2 id="pf-2fa" className="text-lg font-black">{t('pf.2fa.title')}</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${st.enabled ? 'bg-okbg text-ok' : 'bg-black/10 text-mute'}`}>{st.enabled ? t('pf.2fa.on') : t('pf.2fa.off')}</span>
      </div>

      {!st.enabled && !setup && (
        <>
          <p className="font-semibold text-mute">{t('pf.2fa.intro')}</p>
          <ErrorLine text={error} />
          <Button type="button" loading={busy} onClick={() => void start()}>{t('pf.2fa.start')}</Button>
        </>
      )}

      {!st.enabled && setup && (
        <form onSubmit={enable} noValidate className="space-y-3.5">
          <p className="font-semibold text-mute">{t('pf.2fa.scan')}</p>
          <p className="text-sm font-bold">
            <a className="text-link hover:underline" href={setup.uri}>{t('pf.2fa.openApp')}</a>
          </p>
          <div>
            <div className="label">{t('pf.2fa.key')}</div>
            <code className="block rounded-xl bg-black/10 px-3 py-2 font-mono text-sm font-bold break-all select-all">{groups(setup.secret)}</code>
          </div>
          <div>
            <label htmlFor="pf-2fa-code" className="label">{t('pf.2fa.code')}</label>
            <input id="pf-2fa-code" className="input tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} autoFocus />
          </div>
          <ErrorLine text={error} />
          <div className="flex flex-wrap gap-2">
            <Button loading={busy}>{t('pf.2fa.confirm')}</Button>
            <button type="button" className="btn btn-outline" onClick={reset}>{t('pf.2fa.cancel')}</button>
          </div>
        </form>
      )}

      {st.enabled && !disabling && (
        <>
          <p className="font-semibold text-mute">{t('pf.2fa.left', { n: st.recoveryLeft })}</p>
          <button type="button" className="btn btn-outline" onClick={() => setDisabling(true)}>{t('pf.2fa.disable')}</button>
        </>
      )}

      {st.enabled && disabling && (
        <form onSubmit={disable} noValidate className="space-y-3.5">
          <p className="font-semibold text-mute">{t('pf.2fa.disableHint')}</p>
          {st.hasPassword && <PasswordField id="pf-2fa-pass" label={t('pf.2fa.password')} value={password} onChange={setPassword} autoComplete="current-password" />}
          <div>
            <label htmlFor="pf-2fa-dcode" className="label">{t('pf.2fa.code')}</label>
            <input id="pf-2fa-dcode" className="input tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={16} autoFocus />
          </div>
          <ErrorLine text={error} />
          <div className="flex flex-wrap gap-2">
            <Button loading={busy}>{t('pf.2fa.disable')}</Button>
            <button type="button" className="btn btn-outline" onClick={reset}>{t('pf.2fa.cancel')}</button>
          </div>
        </form>
      )}
    </section>
  );
}
