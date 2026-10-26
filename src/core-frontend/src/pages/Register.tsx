import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, setToken } from '../api';
import { useAuth } from '../auth';
import { t } from '../i18n';
import { Button, DiscordButton, ErrorLine, FieldError, OrDivider, PasswordField, PasswordStrength, toast, useShake, errText } from '../ui';

// same rule as on the server: letters of any alphabet, digits, _ . - and single spaces between words
const LOGIN_RE = /^(?=.{3,32}$)[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u;

type Avail = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

/** the registration form; the card around it (brand, tabs) is AuthCard */
export default function Register({ onDone }: { onDone: () => void }) {
  const { access } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [accept, setAccept] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [avail, setAvail] = useState<Avail>('idle');
  const [errs, setErrs] = useState<{ user?: string; pass?: string; repeat?: string; accept?: string }>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const repRef = useRef<HTMLInputElement>(null);
  const acceptRef = useRef<HTMLInputElement>(null);
  const [shakeCls, shake] = useShake();
  const hasRules = access.rules.trim() !== '';

  useEffect(() => { userRef.current?.focus(); }, []);

  // live availability: debounced, and an answer for an older name is ignored
  useEffect(() => {
    const name = username.trim();
    if (!name) { setAvail('idle'); return; }
    if (!LOGIN_RE.test(name)) { setAvail('invalid'); return; }
    setAvail('checking');
    let stale = false;
    const t = setTimeout(() => {
      api<{ valid: boolean; available: boolean }>(`/auth/check?username=${encodeURIComponent(name)}`)
        .then((r) => { if (!stale) setAvail(!r.valid ? 'invalid' : r.available ? 'free' : 'taken'); })
        .catch(() => { if (!stale) setAvail('idle'); });
    }, 400);
    return () => { stale = true; clearTimeout(t); };
  }, [username]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    const name = username.trim();
    const next: typeof errs = {};
    if (!LOGIN_RE.test(name)) next.user = t('reg.rule');
    else if (avail === 'taken') next.user = t('reg.taken');
    if (password.length < 8) next.pass = t('pf.pass.min');
    if (password !== repeat) next.repeat = t('pf.pass.mismatch');
    if (hasRules && !accept) next.accept = t('reg.acceptNeed');
    setErrs(next);
    if (Object.keys(next).length) {
      (next.user ? userRef : next.pass ? passRef : next.repeat ? repRef : acceptRef).current?.focus();
      shake();
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ token?: string; pending?: boolean }>('/auth/register', 'POST', {
        username: name,
        password,
        ...(hasRules ? { acceptRules: true } : {}),
      });
      if (r.token) {
        setToken(r.token);
        toast(t('reg.created'));
        onDone();
      } else {
        setSent(name);
      }
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 409) {
        setErrs({ user: (err as Error).message });
        setAvail('taken');
        userRef.current?.focus();
      } else {
        setError(errText(err));
      }
      shake();
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-okbg text-2xl font-black text-ok" aria-hidden>✓</span>
        <div>
          <h2 className="text-xl font-black">{t('reg.sentTitle')}</h2>
          <p className="mt-1 font-semibold text-mute">
            {t('reg.sentText', { name: sent })}
          </p>
        </div>
        <a href="/login" className="btn w-full">{t('reg.toLogin')}</a>
      </div>
    );
  }

  const availText: Record<Avail, { t: string; cls: string }> = {
    idle: { t: '', cls: '' },
    checking: { t: t('login.checking'), cls: 'text-mute' },
    free: { t: t('reg.free'), cls: 'text-ok' },
    taken: { t: t('reg.takenShort'), cls: 'text-bad' },
    invalid: { t: t('reg.invalid'), cls: 'text-bad' },
  };
  const av = availText[avail];

  return (
    <form onSubmit={submit} noValidate className={`space-y-4 ${shakeCls}`}>
      {access.registrationMode === 'approval' && (
        <p className="rounded-2xl bg-soft px-4 py-2.5 text-sm font-bold text-mute">{t('reg.approval')}</p>
      )}

      <div>
        <label htmlFor="reg-user" className="label">{t('login.user')}</label>
        <input
          id="reg-user"
          ref={userRef}
          className="input"
          value={username}
          onChange={(e) => { setUsername(e.target.value); setErrs((x) => ({ ...x, user: undefined })); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); passRef.current?.focus(); } }}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t('reg.placeholder')}
          aria-invalid={errs.user || avail === 'taken' || avail === 'invalid' ? true : undefined}
          aria-describedby="reg-user-err reg-user-avail"
        />
        <FieldError id="reg-user-err" text={errs.user} />
        <p id="reg-user-avail" aria-live="polite" className={`mt-1.5 text-sm font-bold ${av.cls}`}>
          {!errs.user && av.t}
          {!errs.user && avail === 'invalid' && <span className="font-semibold text-mute">{t('reg.invalidHint')}</span>}
        </p>
      </div>

      <PasswordField
        id="reg-pass"
        ref={passRef}
        label={t('reg.pass')}
        value={password}
        onChange={(v) => { setPassword(v); setErrs((x) => ({ ...x, pass: undefined })); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); repRef.current?.focus(); } }}
        autoComplete="new-password"
        error={errs.pass}
      >
        <PasswordStrength password={password} />
      </PasswordField>

      <PasswordField
        id="reg-pass2"
        ref={repRef}
        label={t('reg.repeat')}
        value={repeat}
        onChange={(v) => { setRepeat(v); setErrs((x) => ({ ...x, repeat: undefined })); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && hasRules && !accept) { e.preventDefault(); acceptRef.current?.focus(); } }}
        autoComplete="new-password"
        error={errs.repeat}
      />

      {hasRules && (
        <div>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm font-bold">
            <input
              ref={acceptRef}
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
              checked={accept}
              onChange={(e) => { setAccept(e.target.checked); setErrs((x) => ({ ...x, accept: undefined })); }}
              aria-invalid={errs.accept ? true : undefined}
              aria-describedby={errs.accept ? 'reg-accept-err' : undefined}
              required
            />
            <span>{t('reg.agree')}</span>
          </label>
          <FieldError id="reg-accept-err" text={errs.accept} />
          <button
            type="button"
            className="btn-link mt-1.5"
            aria-expanded={showRules}
            aria-controls="reg-rules"
            onClick={() => setShowRules((v) => !v)}
          >
            {showRules ? t('reg.hideRules') : t('reg.showRules')}
          </button>
          {showRules && (
            <div id="reg-rules" className="pop mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl bg-soft px-4 py-3 text-sm font-semibold">
              {access.rules}
            </div>
          )}
        </div>
      )}

      <ErrorLine text={error} />
      <Button className="w-full" magnetic loading={busy}>
        {busy ? t('reg.creating') : access.registrationMode === 'approval' ? t('reg.submitApproval') : t('reg.create')}
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
