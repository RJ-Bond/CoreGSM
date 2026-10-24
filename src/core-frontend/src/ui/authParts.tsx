/** Sign-in and first-run screens: backdrop, card, password fields, Discord button. */
import AuthShowcase from '../components/AuthShowcase';
import { type CSSProperties, forwardRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { ICON_PATHS } from '../gameIcons';
import { t } from '../i18n';
import { IconEye, IconEyeOff } from '../icons';
import { Logo, Wordmark } from './blocks';
import { ThemeToggle } from './theme';

// ---------- sign-in / first-run: glow, floating pictograms, one centred card ----------
const FLOATERS: { icon: string; x: string; y: string; s: string; r: string; d: string }[] = [
  { icon: 'cube', x: '6%', y: '12%', s: '54px', r: '-12deg', d: '19s' },
  { icon: 'crosshair', x: '82%', y: '9%', s: '62px', r: '8deg', d: '23s' },
  { icon: 'axe', x: '90%', y: '48%', s: '48px', r: '20deg', d: '17s' },
  { icon: 'shield', x: '4%', y: '58%', s: '58px', r: '-6deg', d: '21s' },
  { icon: 'sword', x: '15%', y: '84%', s: '50px', r: '14deg', d: '25s' },
  { icon: 'headset', x: '74%', y: '82%', s: '56px', r: '-10deg', d: '20s' },
  { icon: 'skull', x: '46%', y: '4%', s: '44px', r: '6deg', d: '24s' },
  { icon: 'paw', x: '58%', y: '90%', s: '46px', r: '-16deg', d: '18s' },
  { icon: 'car', x: '30%', y: '26%', s: '40px', r: '10deg', d: '22s' },
  { icon: 'leaf', x: '68%', y: '30%', s: '40px', r: '-8deg', d: '26s' },
];

function AuthDecor() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="auth-glow" />
      {FLOATERS.map((f) => (
        <svg
          key={f.icon}
          className="auth-float"
          style={{ '--x': f.x, '--y': f.y, '--s': f.s, '--r': f.r, '--d': f.d } as CSSProperties}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={ICON_PATHS[f.icon]} />
        </svg>
      ))}
    </div>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4 pt-20 sm:p-8">
      <AuthDecor />
      <div className="absolute right-4 top-4 z-10"><ThemeToggle /></div>
      <div className="relative z-1 grid w-full max-w-6xl items-center justify-items-center gap-10 xl:grid-cols-[minmax(0,1fr)_24rem_minmax(0,1fr)]">
        <AuthShowcase side="left" />
        {children}
        <AuthShowcase side="right" />
      </div>
    </div>
  );
}

/** the community logo and name, big */
export function AuthBrand({ subtitle }: { subtitle?: string }) {
  return (
    <div className="mb-5 flex flex-col items-center text-center">
      <Logo size={64} alt="" />
      <Wordmark className="mt-2 max-w-full wrap-break-word text-3xl" />
      {subtitle && <p className="mt-0.5 font-semibold text-mute">{subtitle}</p>}
    </div>
  );
}

/** card with the brand block and the Вход / Регистрация switch; the content swaps with an animation */
export function AuthCard({ mode, children }: { mode: 'login' | 'register'; children: ReactNode }) {
  const { access } = useAuth();
  const tabs = [
    { id: 'login', label: t('auth.signIn') },
    { id: 'register', label: t('auth.register') },
  ] as const;
  return (
    <div className="auth-card w-full max-w-sm rounded-[28px] border bg-card/90 p-6 backdrop-blur-sm sm:p-7">
      <AuthBrand subtitle={mode === 'login' ? t('auth.subLogin') : t('auth.subRegister')} />
      {access.registration && (
        <nav className="seg mb-5 flex w-full" aria-label={t('auth.switchAria')}>
          {tabs.map((t) => (
            <a
              key={t.id}
              href={`/${t.id}`}
              aria-current={mode === t.id ? 'page' : undefined}
              className="seg-item flex-1"
            >
              {t.label}
            </a>
          ))}
        </nav>
      )}
      <div key={mode} className="auth-swap">{children}</div>
      {access.publicPanel && (
        <p className="mt-5 text-center text-sm font-bold"><a href="/servers" className="inline-flex items-center text-link hover:underline max-sm:min-h-[44px]">{t('auth.guest')}</a></p>
      )}
    </div>
  );
}

/** returns a class to put on an element and a function that plays the shake once */
export function useShake(): [string, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const shake = () => {
    setOn(false);
    window.clearTimeout(timer.current);
    // next frame: lets the class be removed first so that the animation restarts
    requestAnimationFrame(() => {
      setOn(true);
      timer.current = window.setTimeout(() => setOn(false), 480);
    });
  };
  return [on ? 'shake' : '', shake];
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function FieldError({ id, text }: { id: string; text?: string }) {
  return text ? <p id={id} className="mt-1.5 text-sm font-bold text-bad" role="alert">{text}</p> : null;
}

/** password input with a show/hide button, a Caps Lock warning and an inline error */
export const PasswordField = forwardRef<
  HTMLInputElement,
  {
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    autoComplete: string;
    error?: string;
    hint?: string;
    placeholder?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
    children?: ReactNode;
  }
>(function PasswordField({ id, label, value, onChange, autoComplete, error, hint, placeholder, disabled, autoFocus, onKeyDown, children }, ref) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const describedBy = [error ? `${id}-err` : '', caps ? `${id}-caps` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  const track = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // getModifierState is missing for some synthetic/IME events
    if (typeof e.getModifierState === 'function') setCaps(e.getModifierState('CapsLock'));
  };
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="relative">
        <input
          id={id}
          ref={ref}
          className="input pr-12! max-sm:pr-14!"
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { track(e); onKeyDown?.(e); }}
          onKeyUp={track}
          onBlur={() => setCaps(false)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          autoCapitalize="none"
          spellCheck={false}
        />
        <button
          type="button"
          className="btn-icon-ghost btn-icon-sm absolute right-1 top-1/2 -translate-y-1/2"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? t('pw.hide') : t('pw.show')}
          aria-pressed={shown}
          title={shown ? t('pw.hide') : t('pw.show')}
        >
          {shown ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
      {caps && <p id={`${id}-caps`} className="mt-1.5 text-sm font-bold text-warn">{t('pw.caps')}</p>}
      <FieldError id={`${id}-err`} text={error} />
      {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-sm font-semibold text-mute">{hint}</p>}
      {children}
    </div>
  );
});

/** 0..4; a short password never scores above 1 */
export function passwordScore(p: string): number {
  if (!p) return 0;
  if (p.length < 8) return 1;
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\d/, /[^\p{L}\d]/u].filter((r) => r.test(p)).length;
  let s = 1;
  if (p.length >= 12) s++;
  if (classes >= 2) s++;
  if (classes >= 3 && p.length >= 10) s++;
  return Math.min(4, s);
}

const STRENGTH: { label: () => string; cls: string }[] = [
  { label: () => '', cls: 'bg-soft' },
  { label: () => t('pw.weak'), cls: 'bg-bad' },
  { label: () => t('pw.mid'), cls: 'bg-warn' },
  { label: () => t('pw.good'), cls: 'bg-ok' },
  { label: () => t('pw.great'), cls: 'bg-ok' },
];

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const score = passwordScore(password);
  const st = STRENGTH[score];
  return (
    <div className="mt-2 flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= score ? st.cls : 'bg-soft'}`} />
        ))}
      </div>
      <span className="w-20 text-right text-sm font-extrabold text-mute">{st.label()}</span>
    </div>
  );
}

/** avatar from Discord, or the first letter when there is none (or the image failed to load) */
export function UserAvatar({ name, url, size = 28, tone = 'soft', className = '' }: { name: string; url?: string | null; size?: number; tone?: 'soft' | 'brand' | 'grad'; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (url && !failed) {
    return <img src={url} width={size} height={size} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} className={`shrink-0 rounded-[30%] object-cover ${className}`} style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-[30%] font-black ${tone === 'brand' ? 'bg-brand text-white' : tone === 'grad' ? 'bg-linear-to-br from-brand to-[#ec4899] text-white' : 'bg-soft text-link'} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.48 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export const IconDiscordLogo = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 2.9c-.2.4-.5.9-.6 1.3a18.3 18.3 0 0 0-5.5 0c-.2-.4-.4-.9-.6-1.3A19.7 19.7 0 0 0 3.8 4.4C.5 9 -.3 13.600.1 18.100a19.900 19.900 0 0 0 6 3c.5-.6.9-1.300 1.200-2-.7-.2-1.300-.5-1.900-.9l.4-.3a14.200 14.200 0 0 0 12.100 0l.4.3c-.6.4-1.200.7-1.900.9.4.7.8 1.400 1.200 2a19.900 19.900 0 0 0 6-3c.5-5.200-.8-9.700-3.500-13.700zM8 15.300c-1.200 0-2.200-1.100-2.200-2.400S6.800 10.500 8 10.500s2.200 1.100 2.200 2.400-1 2.400-2.200 2.400zm8 0c-1.200 0-2.200-1.100-2.200-2.400s1-2.400 2.200-2.400 2.200 1.100 2.200 2.400-1 2.400-2.200 2.400z" />
  </svg>
);

/** «linked Discord account» badge: the logo and the Discord name in the brand colour, so it reads without a label */
export function DiscordBadge({ name }: { name: string }) {
  return (
    <span
      className="inline-flex max-w-44 items-center gap-1.5 rounded-full bg-[#5865f2]/15 py-0.5 pl-1.5 pr-2.5 text-xs font-bold text-[#7983f5]"
      title={`Привязан аккаунт Discord: ${name}`}
    >
      <IconDiscordLogo size={14} />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** full-page redirect to Discord; the backend returns to the panel afterwards */
export function DiscordButton({ label, href, className = '' }: { label: string; href: string; className?: string }) {
  return (
    <a
      href={href}
      className={`inline-flex w-full items-center justify-center gap-2.5 rounded-full bg-[#5865f2] px-4 py-2 font-extrabold text-white shadow-pop transition hover:bg-[#4752c4] active:scale-[.98] max-sm:min-h-[44px] ${className}`}
    >
      <IconDiscordLogo />
      {label}
    </a>
  );
}

export function OrDivider() {
  return (
    <div className="my-4 flex items-center gap-3 text-sm font-bold text-mute" aria-hidden>
      <span className="h-px flex-1 bg-line" />
      {t('auth.or')}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
