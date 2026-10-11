import { useState, type FormEvent } from 'react';
import { api, setToken } from '../api';
import { useAuth } from '../auth';
import { AuthShell, ErrorLine, Field, Logo, Wordmark } from '../ui';

export default function Login({ onDone }: { onDone: () => void }) {
  const { access } = useAuth();
  const [username, setUsername] = useState('');
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
    <AuthShell>
      <form onSubmit={submit} className="pop panel w-full max-w-sm space-y-4 p-7">
        <div>
          <div className="mb-1"><Logo size={48} /></div>
          <Wordmark className="text-3xl" />
          <div className="font-semibold text-mute">Вход в аккаунт</div>
        </div>
        <Field label="Логин">
          <input id="login-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </Field>
        <Field label="Пароль">
          <input id="login-pass" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        <ErrorLine text={error} />
        <button className="btn w-full" disabled={busy || !username || !password}>{busy ? 'Проверяю…' : 'Войти'}</button>
        <div className="space-y-1.5 text-center text-sm font-bold text-mute">
          {access.registration && <p>Нет аккаунта? <a href="#/register" className="text-link hover:underline">Зарегистрироваться</a></p>}
          {access.publicPanel && <p><a href="#/servers" className="text-link hover:underline">Продолжить без входа</a></p>}
        </div>
      </form>
    </AuthShell>
  );
}
