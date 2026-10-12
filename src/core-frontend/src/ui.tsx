import { forwardRef, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useAuth } from './auth';
import { api } from './api';
import { GAME_IMAGE, gameAbbr, gameColor } from './games';
import { gameIconPath, ICON_PATHS } from './gameIcons';

export function usePoll(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ref.current();
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** Current route from the URL hash: "#/servers/12" -> { page: 'servers', sub: '12' }. */
export function parseHash(): { page: string; sub: string } {
  const [page = '', ...rest] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { page, sub: rest.join('/') };
}

export function useHash() {
  const [h, setH] = useState(parseHash);
  useEffect(() => {
    const f = () => setH(parseHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

// ---------- formatting ----------
export const ago = (ts: number | null) => {
  if (!ts) return '–';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s} с назад`;
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return `${Math.floor(s / 86400)} дн назад`;
};

export const fmtDateTime = (ts: number) =>
  new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** plural(5, ['сервер', 'сервера', 'серверов']) -> "серверов" */
export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
}

// ---------- icons (24x24, stroke follows the text colour) ----------
function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
export const IconServers = () => (
  <Icon><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01" /></Icon>
);
export const IconCards = () => (
  <Icon><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></Icon>
);
export const IconDiscord = () => (
  <Icon><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 21 12z" /></Icon>
);
export const IconSettings = () => (
  <Icon><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></Icon>
);
export const IconNews = () => (
  <Icon><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12" /></Icon>
);
const IconSun = () => (
  <Icon><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Icon>
);
const IconMoon = () => (
  <Icon><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></Icon>
);
const IconAuto = () => (
  <Icon><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></Icon>
);
export const IconCopy = () => (
  <Icon size={16}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Icon>
);

// ---------- theme ----------
type Theme = 'auto' | 'light' | 'dark';
const THEME_KEY = 'coregsm_theme';
const readTheme = (): Theme => {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
};
function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  try {
    if (t === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode: the theme just is not remembered */
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const next: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };
  const label: Record<Theme, string> = { auto: 'как в системе', light: 'светлая', dark: 'тёмная' };
  return (
    <button
      type="button"
      className="grid h-10 w-10 place-items-center rounded-full bg-card text-mute shadow-pop transition hover:text-link"
      title={`Тема: ${label[theme]}. Нажмите, чтобы переключить`}
      aria-label={`Тема: ${label[theme]}. Переключить`}
      onClick={() => {
        const t = next[theme];
        applyTheme(t);
        setTheme(t);
      }}
    >
      {theme === 'light' ? <IconSun /> : theme === 'dark' ? <IconMoon /> : <IconAuto />}
    </button>
  );
}

// ---------- building blocks ----------
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="pop panel max-h-[92vh] w-full max-w-lg overflow-auto rounded-b-none p-6 sm:rounded-b-3xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-black">{title}</h2>
          <button className="grid h-8 w-8 place-items-center rounded-full bg-soft text-mute hover:text-ink" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function StatusPill({ online, known, lag }: { online: boolean; known: boolean; lag?: boolean }) {
  if (!known) return <span className="pill pill-mute">ОЖИДАНИЕ</span>;
  if (!online) return <span className="pill pill-bad">OFFLINE</span>;
  return lag ? <span className="pill pill-warn">LAG</span> : <span className="pill pill-ok live">ONLINE</span>;
}

export function GameAvatar({ game, size = 44 }: { game: string; size?: number }) {
  const icon = gameIconPath(game);
  const color = gameColor(game);
  return (
    <div
      className="grid shrink-0 place-items-center rounded-2xl font-black text-white shadow-pop"
      style={{ width: size, height: size, background: `linear-gradient(145deg, ${color}, ${color}cc)`, fontSize: size * 0.34 }}
      aria-hidden
    >
      {GAME_IMAGE[game] ? (
        <img src={GAME_IMAGE[game]} width={size * 0.74} height={size * 0.74} alt="" draggable={false} className="object-contain" />
      ) : icon ? (
        <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={icon} />
        </svg>
      ) : (
        gameAbbr(game)
      )}
    </div>
  );
}

export function FillBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-3 overflow-hidden rounded-full bg-soft">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/** 24h player-count sparkline. Loads its own history; shows a quiet placeholder until there are two points. */
export function Spark({ serverId, color }: { serverId: number; color: string }) {
  const [pts, setPts] = useState<number[]>([]);
  usePoll(() => {
    api<{ players: number }[]>(`/servers/${serverId}/history?hours=24`)
      .then((rows) => {
        // downsample to at most 48 points
        const step = Math.max(1, Math.ceil(rows.length / 48));
        setPts(rows.filter((_, i) => i % step === 0).map((r) => r.players));
      })
      .catch(() => undefined);
  }, 60_000);

  if (pts.length < 2) return <div className="h-9 rounded-xl bg-soft/60" aria-hidden />;
  const w = 240, h = 36;
  const max = Math.max(1, ...pts);
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, h - 3 - (v / max) * (h - 6)]);
  const d = 'M' + xy.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');
  const last = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none" role="img" aria-label="Игроки за 24 часа">
      <path d={`${d} L${w} ${h} L0 ${h}Z`} fill={color} opacity="0.14" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={color} />
    </svg>
  );
}

export function PageHead({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3.5">
        {icon && <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-soft text-link">{icon}</span>}
        <div>
          <h1 className="text-3xl font-black tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 font-semibold text-mute">{subtitle}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function ErrorLine({ text }: { text: string }) {
  return text ? <p className="rounded-2xl bg-badbg px-4 py-2.5 font-bold text-bad" role="alert">{text}</p> : null;
}

export function Empty({ title, text, art, children }: { title: string; text: string; art?: ReactNode; children?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center gap-2 px-6 py-10 text-center">
      {art ?? <div className="mb-1 grid h-14 w-14 place-items-center rounded-3xl bg-soft text-2xl text-link">+</div>}
      <h3 className="text-lg font-black">{title}</h3>
      <p className="max-w-sm font-semibold text-mute">{text}</p>
      {children}
    </div>
  );
}

/** Copies text to the clipboard; falls back to a prompt where the Clipboard API is blocked. */
export function CopyButton({ text, label = 'Копировать', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      window.prompt('Скопируйте:', text);
    }
  };
  return (
    <button type="button" className={`btn btn-soft btn-sm ${className}`} onClick={copy} title={label}>
      <IconCopy />
      {done ? 'Скопировано' : label}
    </button>
  );
}

/** The CoreGSM mark (a "C" whose three lights use the status colours). Source art lives in public/. */
export function Logo({ size = 32 }: { size?: number }) {
  const { brand } = useAuth().access;
  return (
    <img
      src={brand.hasLogo ? `/api/branding/logo?v=${brand.logoV}` : '/logo-128.png'}
      width={size}
      height={size}
      alt={brand.name}
      className={`shrink-0 ${brand.hasLogo ? 'rounded-[22%] object-cover' : ''}`}
      draggable={false}
    />
  );
}

export type ProxyType = 'socks5' | 'http';

/** Proxy input: a type selector plus one text field that accepts host:port:login:password, user:pass@host:port or a full URL. */
export function ProxyField({
  id,
  value,
  type,
  onChange,
  onType,
  placeholder,
  disabled,
}: {
  id: string;
  value: string;
  type: ProxyType;
  onChange: (v: string) => void;
  onType: (t: ProxyType) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex gap-2">
        <select
          aria-label="Тип прокси"
          className="input !w-auto shrink-0"
          value={type}
          disabled={disabled}
          onChange={(e) => onType(e.target.value as ProxyType)}
        >
          <option value="socks5">SOCKS5</option>
          <option value="http">HTTP</option>
        </select>
        <input
          id={id}
          className="input font-mono"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          placeholder={placeholder ?? '45.91.9.172:1080:логин:пароль'}
        />
      </div>
      <p className="mt-1.5 text-sm font-semibold text-mute">
        Подойдёт формат <span className="font-mono">адрес:порт:логин:пароль</span> или готовая ссылка с <span className="font-mono">socks5://</span> / <span className="font-mono">http://</span>. Если бот не подключается, смените тип.
      </p>
    </div>
  );
}

/** Opens Discord's own "add bot to a server" screen: the user picks the server there and confirms the permissions. */
export function InviteButton({ url, className = '' }: { url: string | null; className?: string }) {
  if (!url) return null;
  return (
    <a className={`btn ${className}`} href={url} target="_blank" rel="noreferrer">
      Пригласить бота на сервер
      <span aria-hidden>↗</span>
    </a>
  );
}

/** "CoreGSM": Core in the brand colour, GSM in the text colour. */
export function Wordmark({ className = '' }: { className?: string }) {
  const { name } = useAuth().access.brand;
  if (name !== 'CoreGSM') return <span className={`font-extrabold tracking-tight text-ink ${className}`}>{name}</span>;
  return (
    <span className={`font-black tracking-tight text-link ${className}`}>
      Core<span className="text-ink">GSM</span>
    </span>
  );
}

// ---------- toasts: short confirmations that do not interrupt ----------
type ToastKind = 'ok' | 'err' | 'info';
interface ToastItem { id: number; text: string; kind: ToastKind }
let toasts: ToastItem[] = [];
let toastSeq = 0;
const toastListeners = new Set<(t: ToastItem[]) => void>();
const emitToasts = () => toastListeners.forEach((l) => l(toasts));

export function toast(text: string, kind: ToastKind = 'ok', ms = 3500) {
  const t = { id: ++toastSeq, text, kind };
  toasts = [...toasts, t].slice(-4);
  emitToasts();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emitToasts();
  }, ms);
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(toasts);
  useEffect(() => {
    toastListeners.add(setList);
    return () => { toastListeners.delete(setList); };
  }, []);
  const tone = { ok: 'bg-okbg text-ok', err: 'bg-badbg text-bad', info: 'bg-soft text-ink' } as const;
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-24 z-[70] flex flex-col items-center gap-2 md:inset-x-auto md:bottom-6 md:right-6 md:items-end">
      {list.map((t) => (
        <div key={t.id} role="status" className={`pop pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-bold shadow-soft ring-1 ring-black/5 ${tone[t.kind]}`}>
          <span aria-hidden className="text-base">{t.kind === 'ok' ? '✓' : t.kind === 'err' ? '!' : 'i'}</span>
          {t.text}
        </div>
      ))}
    </div>
  );
}

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-8">
      <AuthDecor />
      <div className="absolute right-4 top-4 z-10"><ThemeToggle /></div>
      <div className="relative z-[1] flex w-full justify-center">{children}</div>
    </div>
  );
}

/** the community logo and name, big */
export function AuthBrand({ subtitle }: { subtitle?: string }) {
  return (
    <div className="mb-5 flex flex-col items-center text-center">
      <Logo size={64} />
      <Wordmark className="mt-2 text-3xl" />
      {subtitle && <p className="mt-0.5 font-semibold text-mute">{subtitle}</p>}
    </div>
  );
}

/** card with the brand block and the Вход / Регистрация switch; the content swaps with an animation */
export function AuthCard({ mode, children }: { mode: 'login' | 'register'; children: ReactNode }) {
  const { access } = useAuth();
  const tabs = [
    { id: 'login', label: 'Вход' },
    { id: 'register', label: 'Регистрация' },
  ] as const;
  return (
    <div className="auth-card w-full max-w-sm rounded-3xl border bg-card/90 p-6 backdrop-blur sm:p-7">
      <AuthBrand subtitle={mode === 'login' ? 'Войдите в свой аккаунт' : 'Создайте аккаунт игрока'} />
      {access.registration && (
        <nav className="mb-5 flex gap-1 rounded-full bg-soft p-1" aria-label="Вход или регистрация">
          {tabs.map((t) => (
            <a
              key={t.id}
              href={`#/${t.id}`}
              aria-current={mode === t.id ? 'page' : undefined}
              className={`flex-1 rounded-full px-3 py-1.5 text-center font-extrabold transition ${mode === t.id ? 'bg-brand text-white shadow-pop' : 'text-mute hover:text-ink'}`}
            >
              {t.label}
            </a>
          ))}
        </nav>
      )}
      <div key={mode} className="auth-swap">{children}</div>
      {access.publicPanel && (
        <p className="mt-5 text-center text-sm font-bold"><a href="#/servers" className="text-link hover:underline">Продолжить без входа</a></p>
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

const IconEye = () => (
  <Icon size={20}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Icon>
);
const IconEyeOff = () => (
  <Icon size={20}><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Icon>
);

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
          className="input !pr-11"
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
          className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-mute transition hover:text-ink"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'}
          aria-pressed={shown}
          title={shown ? 'Скрыть пароль' : 'Показать пароль'}
        >
          {shown ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
      {caps && <p id={`${id}-caps`} className="mt-1.5 text-sm font-bold text-warn">Включён Caps Lock</p>}
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

const STRENGTH = [
  { label: '', cls: 'bg-soft' },
  { label: 'Слабый', cls: 'bg-bad' },
  { label: 'Средний', cls: 'bg-warn' },
  { label: 'Хороший', cls: 'bg-ok' },
  { label: 'Отличный', cls: 'bg-ok' },
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
      <span className="w-20 text-right text-sm font-extrabold text-mute">{st.label}</span>
    </div>
  );
}

/** avatar from Discord, or the first letter when there is none (or the image failed to load) */
export function UserAvatar({ name, url, size = 28, tone = 'soft', className = '' }: { name: string; url?: string | null; size?: number; tone?: 'soft' | 'brand'; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (url && !failed) {
    return <img src={url} width={size} height={size} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} className={`shrink-0 rounded-[30%] object-cover ${className}`} style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-[30%] font-black ${tone === 'brand' ? 'bg-brand text-white' : 'bg-soft text-link'} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.48 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

const IconDiscordLogo = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 2.9c-.2.4-.5.9-.6 1.3a18.3 18.3 0 0 0-5.5 0c-.2-.4-.4-.9-.6-1.3A19.7 19.7 0 0 0 3.8 4.4C.5 9 -.3 13.600.1 18.100a19.900 19.900 0 0 0 6 3c.5-.6.9-1.300 1.200-2-.7-.2-1.300-.5-1.900-.9l.4-.3a14.200 14.200 0 0 0 12.100 0l.4.3c-.6.4-1.200.7-1.900.9.4.7.8 1.400 1.200 2a19.900 19.900 0 0 0 6-3c.5-5.200-.8-9.700-3.500-13.700zM8 15.300c-1.200 0-2.200-1.100-2.200-2.400S6.800 10.500 8 10.500s2.200 1.100 2.200 2.400-1 2.400-2.200 2.400zm8 0c-1.200 0-2.200-1.100-2.200-2.400s1-2.400 2.200-2.400 2.200 1.100 2.200 2.400-1 2.400-2.200 2.400z" />
  </svg>
);

/** full-page redirect to Discord; the backend returns to the panel afterwards */
export function DiscordButton({ label, href, className = '' }: { label: string; href: string; className?: string }) {
  return (
    <a
      href={href}
      className={`inline-flex w-full items-center justify-center gap-2.5 rounded-full bg-[#5865f2] px-4 py-2 font-extrabold text-white shadow-pop transition hover:bg-[#4752c4] active:scale-[.98] ${className}`}
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
      или
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

// ---------- fleet status: one segmented bar for online / lag / offline ----------
export function FleetBar({ online, lag, offline }: { online: number; lag: number; offline: number }) {
  const total = online + lag + offline;
  if (total === 0) return null;
  const seg = [
    { n: online, cls: 'bg-ok', label: 'онлайн' },
    { n: lag, cls: 'bg-warn', label: 'лагают' },
    { n: offline, cls: 'bg-bad', label: 'недоступны' },
  ].filter((x) => x.n > 0);
  return (
    <div className="panel px-5 py-4">
      <div className="flex h-2.5 gap-1 overflow-hidden rounded-full" role="img" aria-label={seg.map((x) => `${x.n} ${x.label}`).join(', ')}>
        {seg.map((x) => <div key={x.label} className={`${x.cls} rounded-full transition-all duration-500`} style={{ flex: x.n }} />)}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-sm font-bold text-mute">
        {seg.map((x) => (
          <span key={x.label} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${x.cls}`} />{x.n} {x.label}</span>
        ))}
      </div>
    </div>
  );
}
