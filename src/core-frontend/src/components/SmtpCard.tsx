import { useEffect, useState, type FormEvent } from 'react';
import { api, type SmtpInfo } from '../api';
import { t, useI18n } from '../i18n';
import { ErrorLine, Section, TextField, toast, errText } from '../ui';

/** Settings → security: outgoing e-mail (password reset, address confirmation, new-device letters). Administrators only. */
export default function SmtpCard() {
  useI18n();
  const [info, setInfo] = useState<SmtpInfo | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const apply = (s: SmtpInfo) => {
    setInfo(s);
    setHost(s.host);
    setPort(String(s.port));
    setSecure(s.secure);
    setUser(s.user);
    setFrom(s.from);
    setPassword('');
  };

  useEffect(() => {
    api<SmtpInfo>('/settings/smtp').then(apply).catch((e) => setError(errText(e)));
  }, []);

  const portNum = Number(port);
  const portErr = port && (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) ? t('d2.smtp.portRange') : '';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || portErr) return;
    setError('');
    setNote('');
    setBusy(true);
    try {
      const body: Record<string, unknown> = { host: host.trim(), port: portNum || 587, secure, user: user.trim(), from: from.trim() };
      // empty = keep the saved password
      if (password) body.password = password;
      apply(await api<SmtpInfo>('/settings/smtp', 'PUT', body));
      toast(t('d2.smtp.t.saved'));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const clearPassword = async () => {
    setError('');
    try {
      apply(await api<SmtpInfo>('/settings/smtp', 'PUT', { password: '' }));
    } catch (err) {
      setError(errText(err));
    }
  };

  const test = async () => {
    setError('');
    setNote('');
    setTesting(true);
    try {
      await api('/settings/smtp/test', 'POST', { to: to.trim() });
      setNote(t('d2.smtp.t.test', { to: to.trim() }));
    } catch (err) {
      setError(errText(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section
      title={t('d2.smtp.title')}
      description={t('d2.smtp.desc')}
      actions={info && <span className={`pill ${info.ready ? 'pill-ok' : 'pill-mute'}`}>{info.ready ? t('d2.smtp.ready') : t('d2.smtp.notReady')}</span>}
    >
      <form onSubmit={save} className="space-y-3.5">
        <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <TextField id="smtp-host" label={t('d2.smtp.host')} value={host} onChange={setHost} placeholder="smtp.example.com" noAutofill />
          <TextField id="smtp-port" label={t('d2.sf.port')} value={port} onChange={setPort} inputMode="numeric" error={portErr} autoComplete="off" />
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 font-bold text-mute">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={secure} onChange={(e) => { setSecure(e.target.checked); if (e.target.checked && port === '587') setPort('465'); if (!e.target.checked && port === '465') setPort('587'); }} />
          {t('d2.smtp.secure')}
        </label>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <TextField id="smtp-user" label={t('login.user')} value={user} onChange={setUser} noAutofill />
          <TextField
            id="smtp-pass"
            label={info?.passwordSet ? t('d2.smtp.passSaved') : t('pf.2fa.password')}
            type="password"
            value={password}
            onChange={setPassword}
            noAutofill
          />
        </div>
        <TextField id="smtp-from" label={t('d2.smtp.from')} value={from} onChange={setFrom} placeholder="CoreGSM <no-reply@example.com>" autoComplete="off" />
        {info && !info.publicBase && (
          <p className="rounded-2xl bg-warnbg px-4 py-2.5 text-sm font-bold text-warn">
            {t('d2.smtp.noBase')}
          </p>
        )}
        <ErrorLine text={error} />
        {note && <p className="rounded-ui-lg bg-okbg px-4 py-2.5 font-bold text-ok" role="status">{note}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" disabled={busy || !!portErr}>{t('common.save')}</button>
          {info?.passwordSet && <button type="button" className="btn btn-soft" onClick={() => void clearPassword()}>{t('d2.smtp.delPass')}</button>}
        </div>
      </form>

      <div className="space-y-2 border-t pt-4">
        <TextField id="smtp-to" label={t('d2.smtp.sendTo')} value={to} onChange={setTo} type="email" placeholder="you@example.com" autoComplete="email" />
        <button type="button" className="btn btn-soft" disabled={testing || !to.trim() || !info?.ready} onClick={() => void test()}>
          {testing ? t('d2.smtp.sending') : t('d2.smtp.send')}
        </button>
      </div>
    </Section>
  );
}
