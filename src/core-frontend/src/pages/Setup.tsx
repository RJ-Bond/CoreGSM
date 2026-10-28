import { useRef, useState, type FormEvent } from 'react';
import { api, setToken } from '../api';
import { t, useI18n, type TKey } from '../i18n';
import { AuthBrand, AuthShell, Button, ErrorLine, Field, FieldError, noAutofill, PasswordField, PasswordStrength, ProxyField, useShake, type ProxyType } from '../ui';

const STEPS: TKey[] = ['d2.su.step.account', 'd2.su.step.discord', 'd2.su.step.done'];
// same rule as on the server: letters of any alphabet, digits, _ . - and single spaces between words
const LOGIN_RE = /^(?=.{3,32}$)[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u;

export default function Setup({ onDone }: { onDone: () => void }) {
  useI18n();
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
    if (!LOGIN_RE.test(username.trim())) { shake(); setErrs({ user: t('d2.su.e.user') }); return userRef.current?.focus(); }
    if (password.length < 10) { shake(); setErrs({ pass: t('d2.su.e.pass') }); return passRef.current?.focus(); }
    if (password !== repeat) { shake(); setErrs({ repeat: t('d2.su.e.repeat') }); return repRef.current?.focus(); }
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
        <AuthBrand subtitle={t('d2.su.subtitle')} />

        <ol className="mb-6 flex items-center gap-2" aria-label={t('d2.su.steps')}>
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2" aria-current={i === step ? 'step' : undefined}>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-black ${i < step ? 'bg-okbg text-ok' : i === step ? 'bg-brand text-white' : 'bg-soft text-mute'}`}>
                {i < step ? '✓' : i + 1}
              </span>
              <span className={`text-sm font-extrabold ${i === step ? 'text-ink' : 'text-mute'}`}>{t(s)}</span>
              {i < STEPS.length - 1 && <span className="h-0.5 flex-1 rounded-sm bg-soft" />}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <form onSubmit={next} className="space-y-3.5">
            <Field label={t('d2.su.code')}>
              <input id="setup-code" className="input font-mono" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus autoComplete="off" placeholder={t('d2.su.codeEx')} />
            </Field>
            <p className="-mt-1 text-sm font-semibold text-mute">
              {t('d2.su.codeHint')} <span className="font-mono">grep SETUP_TOKEN /app/.env</span>
            </p>
            <Field label={t('d2.su.login')}>
              <input id="setup-user" ref={userRef} className="input" value={username} onChange={(e) => { setUsername(e.target.value); setErrs((x) => ({ ...x, user: undefined })); }} required autoComplete="username" aria-invalid={errs.user ? true : undefined} aria-describedby={errs.user ? 'setup-user-err' : undefined} />
              <FieldError id="setup-user-err" text={errs.user} />
            </Field>
            <PasswordField id="setup-pass" ref={passRef} label={t('d2.su.passLabel')} value={password} onChange={(v) => { setPassword(v); setErrs((x) => ({ ...x, pass: undefined })); }} autoComplete="new-password" error={errs.pass}>
              <PasswordStrength password={password} />
            </PasswordField>
            <PasswordField
              id="setup-pass2"
              ref={repRef}
              label={t('d2.su.repeatLabel')}
              value={repeat}
              onChange={(v) => { setRepeat(v); setErrs((x) => ({ ...x, repeat: undefined })); }}
              autoComplete="new-password"
              error={errs.repeat}
              hint={repeat && repeat === password && !errs.repeat ? t('d2.su.match') : undefined}
            />
            <ErrorLine text={error} />
            <button className="btn w-full">{t('d2.su.next')}</button>
          </form>
        )}

        {step === 1 && (
          <form onSubmit={(e) => { e.preventDefault(); void finish(false); }} className="space-y-3.5">
            <p className="font-semibold text-mute">{t('d2.su.botNote')}</p>
            <Field label={t('d2.su.token')}>
              <input id="setup-token" className="input font-mono" type="password" value={discordToken} onChange={(e) => setDiscordToken(e.target.value)} {...noAutofill(true)} placeholder={t('d2.su.optional')} />
            </Field>
            <Field label={t('d2.su.proxy')}>
              <ProxyField id="setup-proxy" value={proxyUrl} type={proxyType} onChange={setProxyUrl} onType={setProxyType} />
            </Field>
            <ErrorLine text={error} />
            <div className="flex gap-2 pt-1">
              <button type="button" className="btn btn-soft" onClick={() => setStep(0)} disabled={busy}>{t('wn.back')}</button>
              <button type="button" className="btn btn-soft ml-auto" onClick={() => void finish(true)} disabled={busy}>{t('d2.su.skip')}</button>
              <Button loading={busy}>{busy ? t('d2.su.creating') : t('d2.su.finish')}</Button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-okbg px-4 py-3 font-bold text-ok">{t('d2.su.created', { name: username.trim() })}</div>
            <ol className="space-y-2 font-semibold text-mute">
              <li><span className="font-black text-ink">1.</span> {t('d2.su.todo1')}</li>
              <li><span className="font-black text-ink">2.</span> {discordToken ? t('d2.su.todo2a') : t('d2.su.todo2b')}</li>
            </ol>
            <button className="btn w-full" onClick={onDone}>{t('d2.su.open')}</button>
          </div>
        )}
      </div>
    </AuthShell>
  );
}
