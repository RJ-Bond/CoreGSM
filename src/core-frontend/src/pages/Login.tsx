import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, setToken } from '../api';
import { useAuth } from '../auth';
import { t } from '../i18n';
import { Button, DiscordButton, ErrorLine, FieldError, OrDivider, PasswordField, useShake } from '../ui';

const NAME_KEY = 'coregsm_login_name';
const readName = () => {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
};
const writeName = (v: string) => {
  try { v ? localStorage.setItem(NAME_KEY, v) : localStorage.removeItem(NAME_KEY); } catch { /* not remembered */ }
};

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** the sign-in form; the card around it (brand, tabs) is AuthCard */
export default function Login({ onDone, notice }: { onDone: () => void; notice?: string }) {
  const { access } = useAuth();
  const [username, setUsername] = useState(readName);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => readName() !== '');
  const [userErr, setUserErr] = useState('');
  const [passErr, setPassErr] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const [shakeCls, shake] = useShake();

  // focus the first empty field
  useEffect(() => { (username ? passRef : userRef).current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // lockout countdown
  useEffect(() => {
    if (!lockUntil) return;
    setNow(Date.now());
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= lockUntil) {
        setLockUntil(0);
        setTimeout(() => passRef.current?.focus(), 0);
      }
    }, 250);
    return () => clearInterval(t);
  }, [lockUntil]);

  const left = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
  const locked = left > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || locked) return;
    setUserErr(''); setPassErr(''); setError(''); setPending(false);
    const name = username.trim();
    if (!name || !password) {
      if (!name) setUserErr(t('login.enterUser'));
      if (!password) setPassErr(t('login.enterPass'));
      (name ? passRef : userRef).current?.focus();
      shake();
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ token: string }>('/auth/login', 'POST', { username: name, password });
      writeName(remember ? name : '');
      setToken(r.token);
      onDone();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const data = err instanceof ApiError ? err.data : {};
      if (status === 429) {
        const sec = Math.max(1, Number(data.retryAfter) || 60);
        setLockUntil(Date.now() + sec * 1000);
        setNow(Date.now());
      } else if (status === 403 && data.pending) {
        setPending(true);
      } else if (status === 401) {
        const n = typeof data.attemptsLeft === 'number' ? data.attemptsLeft : null;
        setPassErr(`${(err as Error).message}${n !== null ? t('login.attempts', { n }) : ''}`);
        passRef.current?.focus();
        passRef.current?.select();
      } else {
        setError((err as Error).message);
      }
      shake();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className={`space-y-4 ${shakeCls}`}>
      {notice && <ErrorLine text={notice} />}
      {pending && (
        <p className="rounded-2xl bg-warnbg px-4 py-2.5 font-bold text-warn" role="status">
          {t('login.pending')}
        </p>
      )}
      {locked && (
        <p className="rounded-2xl bg-warnbg px-4 py-2.5 font-bold text-warn" role="status" aria-live="off">
          {t('login.locked', { time: clock(left) })}
        </p>
      )}

      <div>
        <label htmlFor="login-user" className="label">{t('login.user')}</label>
        <input
          id="login-user"
          ref={userRef}
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !password) { e.preventDefault(); passRef.current?.focus(); } }}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          disabled={locked}
          aria-invalid={userErr ? true : undefined}
          aria-describedby={userErr ? 'login-user-err' : undefined}
        />
        <FieldError id="login-user-err" text={userErr} />
      </div>

      <PasswordField
        id="login-pass"
        ref={passRef}
        label={t('login.pass')}
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        error={passErr}
        disabled={locked}
      />

      <label className="flex cursor-pointer items-center gap-2.5 text-sm font-bold text-mute">
        <input type="checkbox" className="h-4 w-4 accent-brand" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        {t('login.remember')}
      </label>

      <p className="-mt-1 text-sm font-bold">
        <a href="/forgot" className="inline-flex items-center text-link hover:underline max-sm:min-h-[44px]">{t('forgot.link')}</a>
      </p>

      <ErrorLine text={error} />
      <Button className="w-full" magnetic loading={busy} disabled={locked}>
        {busy ? t('login.checking') : t('login.submit')}
      </Button>

      {access.discordLogin && (
        <>
          <OrDivider />
          <DiscordButton label={t('auth.discordLogin')} href="/api/auth/discord/start?mode=login" />
          <p className="text-center text-sm font-semibold text-mute">{t('auth.discordRegisterHint')}</p>
        </>
      )}
    </form>
  );
}
