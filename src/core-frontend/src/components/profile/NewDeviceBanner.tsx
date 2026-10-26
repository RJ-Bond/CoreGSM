import { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { confirmDialog } from '../../confirm';
import { t } from '../../i18n';
import { dismissNewDevice, isNewDeviceDismissed } from '../../security';
import { ErrorLine, toast, errText } from '../../ui';

/**
 * «Вход с нового устройства: … Это были вы?» on the Overview and Security tabs of the profile.
 * «Это я» hides it for this sign-in (remembered per timestamp in localStorage); «Нет» ends every other session
 * (the existing revoke-others call) and points at the password form.
 */
export function NewDeviceBanner({ onRevoked }: { onRevoked?: () => void }) {
  const { me } = useAuth();
  const nd = me?.newDevice;
  const [hidden, setHidden] = useState(() => (nd ? isNewDeviceDismissed(nd.ts) : false));
  const [revoked, setRevoked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!nd || (hidden && !revoked)) return null;

  const itWasMe = () => {
    dismissNewDevice(nd.ts);
    setHidden(true);
  };
  const notMe = async () => {
    const ok = await confirmDialog({ title: t('pf.sessions.endAllTitle'), text: t('pf.sessions.endAllText'), confirmLabel: t('pf.sessions.endConfirm'), cancelLabel: t('common.cancel'), danger: true });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ revoked: number }>('/sessions/revoke-others', 'POST');
      toast(t('pf.sessions.revoked', { n: r.revoked }));
      dismissNewDevice(nd.ts);
      setRevoked(true);
      onRevoked?.();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (revoked) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-warnbg px-4 py-3 text-sm font-bold text-warn" role="status">
        <span className="min-w-0 flex-1 basis-60">{t('nd.followup')}</span>
        <span className="flex shrink-0 gap-2">
          <a href="/profile/security" className="btn btn-sm" onClick={() => document.getElementById('pf-current')?.focus()}>{t('nd.changePassword')}</a>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setHidden(true)}>{t('common.close')}</button>
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2" role="region" aria-label={t('nd.title', { label: nd.label })}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl bg-warnbg px-4 py-3 text-warn">
        <span className="min-w-0 flex-1 basis-60 wrap-break-word text-sm font-bold">{t('nd.title', { label: nd.label })}</span>
        <span className="flex shrink-0 flex-wrap gap-2">
          <button type="button" className="btn btn-soft btn-sm" onClick={itWasMe} disabled={busy}>{t('nd.me')}</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => void notMe()} disabled={busy} aria-busy={busy || undefined}>{t('nd.no')}</button>
        </span>
      </div>
      <ErrorLine text={error} />
    </div>
  );
}
