/** Settings → Security: the administrator's own password. */
import { type FormEvent, useState } from 'react';
import { api } from '../../api';
import { t, useI18n } from '../../i18n';
import { ErrorLine, Section, TextField, toast, errText } from '../../ui';

export function PasswordCard() {
  useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // validated while typing (the server checks again)
  const nextError = next && next.length < 10 ? t('d2.pw.more', { n: 10 - next.length }) : next && next === current ? t('d2.pw.same') : '';
  const ready = !!current && next.length >= 10 && !nextError;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setError('');
    setDone(false);
    setBusy(true);
    try {
      await api('/auth/password', 'POST', { current, next });
      setDone(true);
      toast(t('d2.pw.changed'));
      setCurrent('');
      setNext('');
    } catch (err) {
      // the typed values stay in the form: nothing is lost, only the message appears
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('d2.pw.title')}>
      <form onSubmit={submit} className="space-y-3.5">
        <TextField id="pw-current" label={t('d2.pw.current')} type="password" value={current} onChange={(v) => { setCurrent(v); setError(''); }} autoComplete="current-password" />
        <TextField id="pw-next" label={t('d2.pw.new')} type="password" value={next} onChange={setNext} autoComplete="new-password" error={nextError} />
        <ErrorLine text={error} />
        {done && <p className="rounded-ui-lg bg-okbg px-4 py-2.5 font-bold text-ok" role="status">{t('d2.pw.changedDot')}</p>}
        <button className="btn" disabled={!ready || busy}>{t('d2.pw.save')}</button>
      </form>
    </Section>
  );
}
