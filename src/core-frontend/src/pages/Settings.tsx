import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { ErrorLine, Field, PageHead } from '../ui';

export default function SettingsPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setDone(false);
    try {
      await api('/auth/password', 'POST', { current, next });
      setDone(true);
      setCurrent('');
      setNext('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <PageHead title="settings" />
      <form onSubmit={submit} className="max-w-sm space-y-3 rounded border border-line bg-panel p-4">
        <h2 className="text-[11px] uppercase tracking-widest text-mute">Смена пароля администратора</h2>
        <Field label="Текущий пароль">
          <input id="pw-current" className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </Field>
        <Field label="Новый пароль (от 10 символов)">
          <input id="pw-next" className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required />
        </Field>
        <ErrorLine text={error} />
        {done && <p className="rounded border border-ok/40 bg-ok/10 px-3 py-2 text-ok">Пароль изменён.</p>}
        <button className="btn">Сохранить пароль</button>
      </form>
      <p className="max-w-xl text-mute">Токен Discord-бота и домен хранятся в /app/.env на сервере. После изменения выполните <span className="text-fg">cd /app && docker compose up -d</span>.</p>
    </div>
  );
}
