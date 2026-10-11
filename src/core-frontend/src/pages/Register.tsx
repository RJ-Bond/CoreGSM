import { useState, type FormEvent } from 'react';
import { api, setToken } from '../api';
import { useAuth } from '../auth';
import { AuthShell, ErrorLine, Field, Logo, Wordmark, toast } from '../ui';

// same rule as on the server: letters of any alphabet, digits, _ . - and single spaces between words
const LOGIN_RE = /^(?=.{3,32}$)[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u;

export default function Register({ onDone }: { onDone: () => void }) {
  const { access } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!LOGIN_RE.test(username.trim())) return setError('Логин: 3-32 символа: буквы, цифры, пробел между словами, _ . -');
    if (password.length < 8) return setError('Пароль должен быть не короче 8 символов');
    if (password !== repeat) return setError('Пароли не совпадают');
    setBusy(true);
    try {
      const r = await api<{ token: string }>('/auth/register', 'POST', { username: username.trim(), password });
      setToken(r.token);
      toast('Аккаунт создан. Добро пожаловать!');
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <form onSubmit={submit} className="pop panel w-full max-w-sm space-y-4 p-7">
        <div>
          <div className="mb-1"><Logo size={48} /></div>
          <Wordmark className="text-3xl" />
          <div className="font-semibold text-mute">Регистрация игрока</div>
        </div>
        <Field label="Логин">
          <input id="reg-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus placeholder="например, Иван Петров" />
        </Field>
        <Field label="Пароль (от 8 символов)">
          <input id="reg-pass" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} />
        </Field>
        <Field label="Повторите пароль">
          <input id="reg-pass2" className="input" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
        </Field>
        <ErrorLine text={error} />
        <button className="btn w-full" disabled={busy || !username || !password}>{busy ? 'Создаю…' : 'Создать аккаунт'}</button>
        <div className="space-y-1.5 text-center text-sm font-bold text-mute">
          <p>Уже есть аккаунт? <a href="#/login" className="text-link hover:underline">Войти</a></p>
          {access.publicPanel && <p><a href="#/servers" className="text-link hover:underline">Продолжить без входа</a></p>}
        </div>
      </form>
    </AuthShell>
  );
}
