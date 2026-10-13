import { useEffect, useState } from 'react';
import AuthFlow from '../components/AuthFlow';
import { api } from '../api';
import { useAuth } from '../auth';
import { t } from '../i18n';
import { Spinner } from '../ui';

// one request per link even when the effect runs twice (React strict mode, re-render of the shell)
const requested = new Map<string, Promise<{ email: string } | null>>();
function confirmLink(token: string) {
  let p = requested.get(token);
  if (!p) {
    p = api<{ ok: boolean; email: string }>('/auth/verify-email', 'POST', { token }).then((r) => ({ email: r.email })).catch(() => null);
    requested.set(token, p);
  }
  return p;
}

/** #/verify/<token>: confirms the e-mail address of the account */
export default function VerifyEmail({ token }: { token: string }) {
  const { me, reload } = useAuth();
  const [state, setState] = useState<'checking' | 'ok' | 'bad'>('checking');
  const [email, setEmail] = useState('');

  useEffect(() => {
    let live = true;
    if (!token) { setState('bad'); return; }
    void confirmLink(token).then((r) => {
      if (!live) return;
      if (r) { setEmail(r.email); setState('ok'); void reload(); } else setState('bad');
    });
    return () => { live = false; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = me ? <a href="#/profile" className="btn w-full justify-center">{t('verify.toProfile')}</a> : <a href="#/login" className="btn w-full justify-center">{t('reset.toLogin')}</a>;

  if (state === 'checking') {
    return (
      <AuthFlow title={t('verify.title')}>
        <p className="flex items-center justify-center gap-2 font-semibold text-mute" role="status"><Spinner /> {t('verify.checking')}</p>
      </AuthFlow>
    );
  }
  if (state === 'ok') {
    return (
      <AuthFlow title={t('verify.okTitle')}>
        <p className="rounded-2xl bg-okbg px-4 py-3 font-bold text-ok" role="status">{t('verify.okText', { email })}</p>
        {next}
      </AuthFlow>
    );
  }
  return (
    <AuthFlow title={t('verify.badTitle')}>
      <p className="rounded-2xl bg-badbg px-4 py-3 font-bold text-bad" role="alert">{t('verify.badText')}</p>
      {next}
    </AuthFlow>
  );
}
