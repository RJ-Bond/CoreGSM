import { useState, type FormEvent } from 'react';
import { api, setToken } from '../api';
import { ErrorLine, Field, Logo, Wordmark } from '../ui';

export default function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ token: string }>('/auth/login', 'POST', { username, password });
      setToken(r.token);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={submit} className="pop panel w-full max-w-sm space-y-4 p-7">
        <div>
          <div className="mb-1"><Logo size={48} /></div>
          <Wordmark className="text-3xl" />
          <div className="font-semibold text-mute">Войдите в панель управления</div>
        </div>
        <Field label="Логин">
          <input id="login-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </Field>
        <Field label="Пароль">
          <input id="login-pass" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        </Field>
        <ErrorLine text={error} />
        <button className="btn w-full" disabled={busy || !password}>{busy ? 'Проверяю…' : 'Войти'}</button>
      </form>
    </div>
  );
}
