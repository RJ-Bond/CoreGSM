import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { t } from '../i18n';
import { toast } from '../ui';

/** Under the e-mail field of the profile: whether the saved address is confirmed, and a button to send the letter. */
export default function EmailVerifyState() {
  const { me } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!me?.email) return null;
  if (me.emailVerified) return <p className="text-sm font-bold text-ok" role="status">{t('pf.emailv.verified')}</p>;

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/me/email/verify-request', 'POST');
      toast(t('pf.emailv.sent', { email: me.email ?? '' }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-bold text-warn">{t('pf.emailv.unverified')}</p>
      <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void send()}>{t('pf.emailv.send')}</button>
      {error && <p className="text-sm font-bold text-bad" role="alert">{error}</p>}
    </div>
  );
}
