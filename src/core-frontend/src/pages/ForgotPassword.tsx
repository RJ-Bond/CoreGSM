import { useEffect, useRef, useState, type FormEvent } from 'react';
import AuthFlow from '../components/AuthFlow';
import { api, ApiError } from '../api';
import { t } from '../i18n';
import { Button, ErrorLine, FieldError, useShake } from '../ui';

/** #/forgot: asks for a login or e-mail; the answer is the same whether or not such an account exists */
export default function ForgotPassword() {
  const [login, setLogin] = useState('');
  const [err, setErr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const [shakeCls, shake] = useShake();
  useEffect(() => { ref.current?.focus(); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(''); setError('');
    if (!login.trim()) { setErr(t('forgot.enter')); ref.current?.focus(); shake(); return; }
    setBusy(true);
    try {
      await api('/auth/forgot', 'POST', { login: login.trim() });
      setSent(true);
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : t('common.retry'));
      shake();
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthFlow title={t('forgot.sentTitle')}>
        <p className="rounded-2xl bg-okbg px-4 py-3 font-bold text-ok" role="status">{t('forgot.sentText')}</p>
        <p className="text-sm font-semibold text-mute">{t('forgot.noMail')}</p>
      </AuthFlow>
    );
  }

  return (
    <AuthFlow title={t('forgot.title')} subtitle={t('forgot.sub')}>
      <form onSubmit={submit} noValidate className={`space-y-4 ${shakeCls}`}>
        <div>
          <label htmlFor="forgot-login" className="label">{t('forgot.login')}</label>
          <input
            id="forgot-login"
            ref={ref}
            className="input"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={err ? true : undefined}
            aria-describedby={err ? 'forgot-login-err' : undefined}
          />
          <FieldError id="forgot-login-err" text={err} />
        </div>
        <ErrorLine text={error} />
        <Button className="w-full" loading={busy}>{busy ? t('forgot.sending') : t('forgot.submit')}</Button>
      </form>
    </AuthFlow>
  );
}
