/** Settings → Security: the administrator's own password. */
import { type FormEvent, useState } from 'react';
import { api } from '../../api';
import { ErrorLine, plural, Section, TextField, toast, errText } from '../../ui';

export function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // validated while typing (the server checks again)
  const nextError = next && next.length < 10 ? `Ещё ${10 - next.length} ${plural(10 - next.length, ['символ', 'символа', 'символов'])}: нужно от 10` : next && next === current ? 'Новый пароль совпадает с текущим' : '';
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
      toast('Пароль изменён');
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
    <Section title="Пароль администратора">
      <form onSubmit={submit} className="space-y-3.5">
        <TextField id="pw-current" label="Текущий пароль" type="password" value={current} onChange={(v) => { setCurrent(v); setError(''); }} autoComplete="current-password" />
        <TextField id="pw-next" label="Новый пароль (от 10 символов)" type="password" value={next} onChange={setNext} autoComplete="new-password" error={nextError} />
        <ErrorLine text={error} />
        {done && <p className="rounded-ui-lg bg-okbg px-4 py-2.5 font-bold text-ok" role="status">Пароль изменён.</p>}
        <button className="btn" disabled={!ready || busy}>Сохранить пароль</button>
      </form>
    </Section>
  );
}
