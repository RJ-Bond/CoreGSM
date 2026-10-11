import { useState, type FormEvent } from 'react';
import { api, setToken } from '../api';
import { ErrorLine, Field, Logo, ProxyField, Wordmark, type ProxyType } from '../ui';

const STEPS = ['Аккаунт', 'Discord', 'Готово'];
// same rule as on the server: letters of any alphabet, digits, _ . - and single spaces between words
const LOGIN_RE = /^(?=.{3,32}$)[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u;

export default function Setup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [discordToken, setDiscordToken] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyType, setProxyType] = useState<ProxyType>('socks5');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const next = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!LOGIN_RE.test(username.trim())) return setError('Логин: 3-32 символа: буквы, цифры, пробел между словами, _ . -');
    if (password.length < 10) return setError('Пароль должен быть не короче 10 символов');
    if (password !== repeat) return setError('Пароли не совпадают');
    setStep(1);
  };

  const finish = async (skip: boolean) => {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ token: string }>('/setup', 'POST', {
        code,
        username: username.trim(),
        password,
        ...(skip ? {} : { discordToken, proxyUrl, proxyType }),
      });
      setToken(r.token);
      setStep(2);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      // a wrong code is on the first step
      if (msg.includes('код')) setStep(0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="pop panel w-full max-w-md p-7">
        <div className="mb-2"><Logo size={48} /></div>
        <Wordmark className="mb-1 block text-3xl" />
        <p className="mb-5 font-semibold text-mute">Первоначальная настройка панели</p>

        <ol className="mb-6 flex items-center gap-2" aria-label="Шаги">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2" aria-current={i === step ? 'step' : undefined}>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-black ${i < step ? 'bg-okbg text-ok' : i === step ? 'bg-brand text-white' : 'bg-soft text-mute'}`}>
                {i < step ? '✓' : i + 1}
              </span>
              <span className={`text-sm font-extrabold ${i === step ? 'text-ink' : 'text-mute'}`}>{s}</span>
              {i < STEPS.length - 1 && <span className="h-0.5 flex-1 rounded bg-soft" />}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <form onSubmit={next} className="space-y-3.5">
            <Field label="Код установки">
              <input id="setup-code" className="input font-mono" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus autoComplete="off" placeholder="из вывода install.sh" />
            </Field>
            <p className="-mt-1 text-sm font-semibold text-mute">
              Код показан в конце установки. Если потерялся: <span className="font-mono">grep SETUP_TOKEN /app/.env</span>
            </p>
            <Field label="Логин администратора">
              <input id="setup-user" className="input" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
            </Field>
            <Field label="Пароль (от 10 символов)">
              <input id="setup-pass" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoComplete="new-password" />
            </Field>
            <Field label="Повторите пароль">
              <input id="setup-pass2" className="input" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required autoComplete="new-password" />
            </Field>
            <ErrorLine text={error} />
            <button className="btn w-full">Далее</button>
          </form>
        )}

        {step === 1 && (
          <form onSubmit={(e) => { e.preventDefault(); void finish(false); }} className="space-y-3.5">
            <p className="font-semibold text-mute">Бот публикует карточки серверов в Discord. Это можно настроить и позже, в разделе «Настройки».</p>
            <Field label="Токен Discord-бота">
              <input id="setup-token" className="input font-mono" type="password" value={discordToken} onChange={(e) => setDiscordToken(e.target.value)} autoComplete="off" placeholder="необязательно" />
            </Field>
            <Field label="Прокси для Discord">
              <ProxyField id="setup-proxy" value={proxyUrl} type={proxyType} onChange={setProxyUrl} onType={setProxyType} />
            </Field>
            <ErrorLine text={error} />
            <div className="flex gap-2 pt-1">
              <button type="button" className="btn btn-soft" onClick={() => setStep(0)} disabled={busy}>Назад</button>
              <button type="button" className="btn btn-soft ml-auto" onClick={() => void finish(true)} disabled={busy}>Пропустить</button>
              <button className="btn" disabled={busy}>{busy ? 'Создаю…' : 'Завершить'}</button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-okbg px-4 py-3 font-bold text-ok">Администратор «{username.trim()}» создан.</div>
            <ol className="space-y-2 font-semibold text-mute">
              <li><span className="font-black text-ink">1.</span> Добавьте игровой сервер на вкладке «Серверы».</li>
              <li><span className="font-black text-ink">2.</span> {discordToken ? 'Привяжите Discord-канал на вкладке «Discord».' : 'Укажите токен бота в «Настройки», затем привяжите канал на вкладке «Discord».'}</li>
            </ol>
            <button className="btn w-full" onClick={onDone}>Открыть панель</button>
          </div>
        )}
      </div>
    </div>
  );
}
