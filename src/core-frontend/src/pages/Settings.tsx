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
    <div className="space-y-6">
      <PageHead title="Настройки" subtitle="Доступ к панели и конфигурация сервера" />
      <div className="grid gap-5 md:grid-cols-2">
        <form onSubmit={submit} className="panel space-y-3.5 p-6">
          <h2 className="text-lg font-black">Пароль администратора</h2>
          <Field label="Текущий пароль">
            <input id="pw-current" className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Field label="Новый пароль (от 10 символов)">
            <input id="pw-next" className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required />
          </Field>
          <ErrorLine text={error} />
          {done && <p className="rounded-2xl bg-okbg px-4 py-2.5 font-bold text-ok" role="status">Пароль изменён.</p>}
          <button className="btn">Сохранить пароль</button>
        </form>
        <div className="panel space-y-2 p-6">
          <h2 className="text-lg font-black">Бот, домен и прокси</h2>
          <p className="font-semibold text-mute">
            Токен Discord-бота, домен и прокси хранятся в <span className="font-mono text-[13px] text-ink">/app/.env</span> на сервере.
            После изменения выполните:
          </p>
          <p className="rounded-2xl bg-soft px-4 py-2.5 font-mono text-[13px] font-bold">cd /app && docker compose up -d</p>
        </div>
      </div>
    </div>
  );
}
