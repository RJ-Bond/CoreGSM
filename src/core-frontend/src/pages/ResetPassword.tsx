import { useEffect, useRef, useState, type FormEvent } from 'react';
import AuthFlow from '../components/AuthFlow';
import { api, ApiError } from '../api';
import { t } from '../i18n';
import { Button, ErrorLine, PasswordField, PasswordStrength, useShake, errText } from '../ui';

/** /reset/<token>: the link from the letter; sets a new password (valid 30 minutes, once) */
export default function ResetPassword({ token }: { token: string }) {
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [passErr, setPassErr] = useState('');
  const [againErr, setAgainErr] = useState('');
  const [error, setError] = useState('');
  const [bad, setBad] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const passRef = useRef<HTMLInputElement>(null);
  const againRef = useRef<HTMLInputElement>(null);
  const [shakeCls, shake] = useShake();
  useEffect(() => { passRef.current?.focus(); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setPassErr(''); setAgainErr(''); setError('');
    if (pass.length < 8) { setPassErr(t('pf.pass.min')); passRef.current?.focus(); shake(); return; }
    if (pass !== again) { setAgainErr(t('pf.pass.mismatch')); againRef.current?.focus(); shake(); return; }
    setBusy(true);
    try {
      await api('/auth/reset', 'POST', { token, password: pass });
      setDone(true);
    } catch (err) {
      // 400 with a password message is a form problem; any other 400 means the link is dead
      if (err instanceof ApiError && err.status === 400 && !/парол/i.test(err.message)) setBad(true);
      else setError(errText(err));
      shake();
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthFlow title={t('reset.doneTitle')}>
        <p className="rounded-2xl bg-okbg px-4 py-3 font-bold text-ok" role="status">{t('reset.doneText')}</p>
        <a href="/login" className="btn w-full justify-center">{t('reset.toLogin')}</a>
      </AuthFlow>
    );
  }

  if (bad || !token) {
    return (
      <AuthFlow title={t('reset.badTitle')}>
        <p className="rounded-2xl bg-badbg px-4 py-3 font-bold text-bad" role="alert">{t('reset.badText')}</p>
        <a href="/forgot" className="btn w-full justify-center">{t('reset.again')}</a>
      </AuthFlow>
    );
  }

  return (
    <AuthFlow title={t('reset.title')} subtitle={t('reset.sub')}>
      <form onSubmit={submit} noValidate className={`space-y-4 ${shakeCls}`}>
        <PasswordField id="reset-pass" ref={passRef} label={t('pf.pass.new')} value={pass} onChange={setPass} autoComplete="new-password" error={passErr}>
          <PasswordStrength password={pass} />
        </PasswordField>
        <PasswordField id="reset-again" ref={againRef} label={t('pf.pass.again')} value={again} onChange={(v) => { setAgain(v); setAgainErr(''); }} autoComplete="new-password" error={againErr} />
        <ErrorLine text={error} />
        <Button className="w-full" loading={busy}>{busy ? t('reset.saving') : t('reset.submit')}</Button>
      </form>
    </AuthFlow>
  );
}
