import { useState, type FormEvent } from 'react';
import { api, getToken } from '../../api';
import { useAuth } from '../../auth';
import { t } from '../../i18n';
import { Button, ErrorLine, Section, TextField, toast, errText } from '../../ui';

/** «Ваши данные»: download everything the panel keeps about the account, or delete the account for good */
export function AccountDataCard() {
  const { me } = useAuth();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  if (!me) return null;

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const token = getToken();
      const res = await fetch('/api/me/export', { headers: token ? { authorization: `Bearer ${token}` } : {}, credentials: 'same-origin' });
      if (!res.ok) throw new Error(t('pf.data.exportFail'));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `coregsm-${me.username}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(t('pf.data.exported'));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/me', 'DELETE', me.hasPassword ? { password: secret } : { confirm: secret });
      toast(t('pf.data.deleted'));
      window.location.href = '/login';
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <Section title={t('pf.data.title')} description={t('pf.data.desc')}>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="soft" loading={busy && !asking} onClick={() => void download()}>{t('pf.data.export')}</Button>
        {!asking && <button type="button" className="btn-link-danger" onClick={() => { setAsking(true); setError(''); }}>{t('pf.data.delete')}</button>}
      </div>
      {asking && (
        <form onSubmit={remove} className="pf-danger" noValidate>
          <p className="font-bold text-bad">{t('pf.data.delHint')}</p>
          <TextField
            id="del-secret"
            label={me.hasPassword ? t('pf.data.delPass') : t('pf.data.delConfirm', { name: me.username })}
            type={me.hasPassword ? 'password' : 'text'}
            value={secret}
            onChange={setSecret}
            autoComplete={me.hasPassword ? 'current-password' : 'off'}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="danger" loading={busy} disabled={!secret}>{t('pf.data.delGo')}</Button>
            <button type="button" className="btn-link" onClick={() => { setAsking(false); setSecret(''); setError(''); }}>{t('common.cancel')}</button>
          </div>
        </form>
      )}
      <ErrorLine text={error} />
    </Section>
  );
}
