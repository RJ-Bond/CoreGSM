import { useRef, useState, type FormEvent } from 'react';
import { api, setToken } from '../api';
import { AuthBrand, AuthShell, Button, ErrorLine, Field, FieldError, noAutofill, PasswordField, PasswordStrength, ProxyField, useShake, type ProxyType } from '../ui';

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
  // a mistake is shown at its own field, the focus goes there
  const [errs, setErrs] = useState<{ user?: string; pass?: string; repeat?: string }>({});
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const repRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [shakeCls, shake] = useShake();

  const next = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setErrs({});
    if (!LOGIN_RE.test(username.trim())) { shake(); setErrs({ user: 'Логин: 3-32 символа: буквы, цифры, пробел между словами, _ . -' }); return userRef.current?.focus(); }
    if (password.length < 10) { shake(); setErrs({ pass: 'Пароль должен быть не короче 10 символов' }); return passRef.current?.focus(); }
    if (password !== repeat) { shake(); setErrs({ repeat: 'Пароли не совпадают' }); return repRef.current?.focus(); }
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
    <AuthShell>
      <div className={`auth-card w-full max-w-md rounded-3xl border bg-card/90 p-6 backdrop-blur-sm sm:p-7 ${shakeCls}`}>
        <AuthBrand subtitle="Первоначальная настройка панели" />

        <ol className="mb-6 flex items-center gap-2" aria-label="Шаги">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2" aria-current={i === step ? 'step' : undefined}>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-black ${i < step ? 'bg-okbg text-ok' : i === step ? 'bg-brand text-white' : 'bg-soft text-mute'}`}>
                {i < step ? '✓' : i + 1}
              </span>
              <span className={`text-sm font-extrabold ${i === step ? 'text-ink' : 'text-mute'}`}>{s}</span>
              {i < STEPS.length - 1 && <span className="h-0.5 flex-1 rounded-sm bg-soft" />}
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
              <input id="setup-user" ref={userRef} className="input" value={username} onChange={(e) => { setUsername(e.target.value); setErrs((x) => ({ ...x, user: undefined })); }} required autoComplete="username" aria-invalid={errs.user ? true : undefined} aria-describedby={errs.user ? 'setup-user-err' : undefined} />
              <FieldError id="setup-user-err" text={errs.user} />
            </Field>
            <PasswordField id="setup-pass" ref={passRef} label="Пароль (от 10 символов)" value={password} onChange={(v) => { setPassword(v); setErrs((x) => ({ ...x, pass: undefined })); }} autoComplete="new-password" error={errs.pass}>
              <PasswordStrength password={password} />
            </PasswordField>
            <PasswordField
              id="setup-pass2"
              ref={repRef}
              label="Повторите пароль"
              value={repeat}
              onChange={(v) => { setRepeat(v); setErrs((x) => ({ ...x, repeat: undefined })); }}
              autoComplete="new-password"
              error={errs.repeat}
              hint={repeat && repeat === password && !errs.repeat ? 'Пароли совпадают ✓' : undefined}
            />
            <ErrorLine text={error} />
            <button className="btn w-full">Далее</button>
          </form>
        )}

        {step === 1 && (
          <form onSubmit={(e) => { e.preventDefault(); void finish(false); }} className="space-y-3.5">
            <p className="font-semibold text-mute">Бот публикует карточки серверов в Discord. Это можно настроить и позже, в разделе «Настройки».</p>
            <Field label="Токен Discord-бота">
              <input id="setup-token" className="input font-mono" type="password" value={discordToken} onChange={(e) => setDiscordToken(e.target.value)} {...noAutofill(true)} placeholder="необязательно" />
            </Field>
            <Field label="Прокси для Discord">
              <ProxyField id="setup-proxy" value={proxyUrl} type={proxyType} onChange={setProxyUrl} onType={setProxyType} />
            </Field>
            <ErrorLine text={error} />
            <div className="flex gap-2 pt-1">
              <button type="button" className="btn btn-soft" onClick={() => setStep(0)} disabled={busy}>Назад</button>
              <button type="button" className="btn btn-soft ml-auto" onClick={() => void finish(true)} disabled={busy}>Пропустить</button>
              <Button loading={busy}>{busy ? 'Создаю…' : 'Завершить'}</Button>
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
    </AuthShell>
  );
}
