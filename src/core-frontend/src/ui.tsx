import { forwardRef, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { revealTransition, withViewTransition } from './useMotion';
import { useAuth } from './auth';
import AuthShowcase from './components/AuthShowcase';
import { getToken, type Server } from './api';
import { promptDialog, useBackdropClose, useDialogFocus } from './confirm';
import { GAME_IMAGE, gameAbbr, gameGradient } from './games';
import { gameIconPath, ICON_PATHS } from './gameIcons';
import { getPrefs, t, t as tr } from './i18n';
import { IconAuto, IconCheck, IconClose, IconCopy, IconError, IconEye, IconEyeOff, IconInfo, IconMoon, IconOk, IconSun } from './icons';

// one icon set (24 px grid, 2 px stroke, currentColor): see icons.tsx; every icon is re-exported from here
export * from './icons';

/**
 * Calls `fn` now and then every `ms` milliseconds.
 * - nothing runs while the tab is hidden; coming back to the tab refreshes at once
 * - a tick is skipped while the previous call (if it returns a promise) is still pending
 * - nothing is scheduled after unmount
 */
export function usePoll(fn: () => unknown, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let alive = true;
    let pending = false;
    const run = async () => {
      if (!alive || pending || document.hidden) return;
      pending = true;
      try {
        await ref.current();
      } catch {
        /* the caller shows its own errors */
      } finally {
        pending = false;
      }
    };
    void run();
    const t = setInterval(() => void run(), ms);
    const onVisible = () => { if (!document.hidden) void run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ms]);
}

/** a server answers, but slowly (ping over 100 ms) */
export const LAG_PING = 100;
export const isLag = (s: Pick<Server, 'online' | 'ping'>) => s.online && s.ping != null && s.ping > LAG_PING;

// shared building blocks live in their own files; pages import everything from here
export { Button } from './components/Button';
export type { ButtonProps } from './components/Button';
export { Switch } from './components/Switch';
export { SplitButton } from './components/SplitButton';
export { StateView, LoadError, errorKind } from './components/StateView';
export type { StateKind } from './components/StateView';
import { StateView } from './components/StateView';
export type { SplitItem } from './components/SplitButton';
export { useFlashOnChange, useDepth, useDensity, setDensity, prefersReducedMotion } from './useMotion';
export type { Density } from './useMotion';

const reducedMotion = () => typeof window !== 'undefined' && (document.documentElement.dataset.motion === 'reduce' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** the number counts to its new value instead of jumping (about 600 ms; instant with reduced motion) */
export function useTween(value: number, ms = 600): number {
  const [shown, setShown] = useState(value);
  const cur = useRef(value);
  useEffect(() => {
    if (cur.current === value) return;
    if (reducedMotion()) { cur.current = value; setShown(value); return; }
    const from = cur.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      cur.current = k >= 1 ? value : Math.round(from + (value - from) * eased);
      setShown(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Tabular number whose digits roll vertically (slot-machine style) when the value changes.
 * `pulse`: the number glows briefly; `delta`: a «+3» / «−2» chip floats above it for about two seconds.
 * The real number is in a visually hidden node, the rolling digits are decoration (aria-hidden); no layout shift.
 */
export function AnimatedNumber({ value, className = '', pulse = false, delta = false }: { value: number; className?: string; pulse?: boolean; delta?: boolean }) {
  const [bump, setBump] = useState(false);
  const [chip, setChip] = useState<{ n: number; k: number } | null>(null);
  const prev = useRef(value);
  const born = useRef(true);
  useEffect(() => {
    const diff = value - prev.current;
    prev.current = value;
    if (born.current) { born.current = false; return; }
    if (diff === 0) return;
    const timers: number[] = [];
    if (pulse) {
      setBump(true);
      timers.push(window.setTimeout(() => setBump(false), 950));
    }
    if (delta) {
      setChip({ n: diff, k: Date.now() });
      timers.push(window.setTimeout(() => setChip(null), 2100));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [value, pulse, delta]);

  const text = String(Math.round(value));
  const chars = [...text];
  return (
    <span className={`roll ${bump ? 'num-bump' : ''} ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {chars.map((c, i) => {
          // keyed from the right, so a column keeps its identity when the number grows by a digit
          const key = chars.length - i;
          return /\d/.test(c)
            ? (
              <span key={key} className="roll-d">
                <span className="roll-g">0</span>
                <span className="roll-col" style={{ transform: `translateY(${-Number(c)}em)` }}>
                  {DIGITS.map((d) => <span key={d}>{d}</span>)}
                </span>
              </span>
            )
            : <span key={key}>{c}</span>;
        })}
      </span>
      {chip && <span key={chip.k} aria-hidden className={`delta-chip ${chip.n > 0 ? 'up' : 'down'}`}>{chip.n > 0 ? `+${chip.n}` : `−${Math.abs(chip.n)}`}</span>}
    </span>
  );
}

/** Current route from the URL hash: "#/servers/12" -> { page: 'servers', sub: '12' }. */
export function parseHash(): { page: string; sub: string } {
  const [page = '', ...rest] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { page, sub: rest.join('/') };
}

// One hashchange listener for the whole app: every subscriber is updated together, inside one view transition
// (cross-fade with a slight slide, and the server avatar morphing from its tile to the page banner).
type HashState = { page: string; sub: string };
let hashNow: HashState | null = null;
const hashListeners = new Set<(h: HashState) => void>();

const serverIdOf = (h: HashState) => (h.page === 'servers' && /^\d+$/.test(h.sub.split('/')[0]) ? h.sub.split('/')[0] : '');

/** gives the avatar of a server (tagged data-vt-avatar) the view-transition-name that pairs the old and the new page */
const nameAvatars = (ids: string[]) => {
  for (const id of new Set(ids.filter(Boolean))) {
    document.querySelector<HTMLElement>(`[data-vt-avatar="${id}"]`)?.style.setProperty('view-transition-name', `server-${id}`);
  }
};
const clearAvatarNames = () => {
  document.querySelectorAll<HTMLElement>('[data-vt-avatar]').forEach((el) => el.style.removeProperty('view-transition-name'));
};

function onHashChange() {
  const prev = hashNow ?? parseHash();
  const next = parseHash();
  if (prev.page === next.page && prev.sub === next.sub) return;
  // switching tabs inside one server page ("12" -> "12/players") is not a page change: no cross-fade
  if (prev.page === 'servers' && next.page === 'servers' && /^\d+(\/|$)/.test(next.sub) && prev.sub.split('/')[0] === next.sub.split('/')[0]) {
    hashNow = next;
    hashListeners.forEach((l) => l(next));
    return;
  }
  // No View Transition here: the glass header and the bottom bar (backdrop-filter) were captured as separate
  // layers and flashed as a black rectangle while switching sections. The page itself fades in via .pop / .fade-in.
  hashNow = next;
  hashListeners.forEach((l) => l(next));
}
void withViewTransition;
void nameAvatars;
void clearAvatarNames;
void serverIdOf;

export function useHash() {
  const [h, setH] = useState(parseHash);
  useEffect(() => {
    if (hashNow === null) {
      hashNow = parseHash();
      window.addEventListener('hashchange', onHashChange);
    }
    hashListeners.add(setH);
    // the address may have changed between the first render and now
    const cur = parseHash();
    setH((p) => (p.page === cur.page && p.sub === cur.sub ? p : cur));
    return () => { hashListeners.delete(setH); };
  }, []);
  return h;
}

// ---------- formatting ----------
// Dates and times honour the user's regional settings (time zone, 12/24 h, date order): see «Оформление и регион».
export const ago = (ts: number | null) => {
  if (!ts) return '–';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return t('ago.s', { n: s });
  if (s < 3600) return t('ago.m', { n: Math.floor(s / 60) });
  if (s < 86400) return t('ago.h', { n: Math.floor(s / 3600) });
  return t('ago.d', { n: Math.floor(s / 86400) });
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();
const zonedFormatter = (tz: string): Intl.DateTimeFormat => {
  let f = dtfCache.get(tz);
  if (!f) {
    const base: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
    try {
      f = new Intl.DateTimeFormat('en-US', { ...base, timeZone: tz || undefined });
    } catch {
      f = new Intl.DateTimeFormat('en-US', base);
    }
    dtfCache.set(tz, f);
  }
  return f;
};

/** calendar fields of a moment in the chosen time zone */
function zoned(ts: number) {
  const o: Record<string, string> = {};
  for (const p of zonedFormatter(getPrefs().timezone).formatToParts(ts)) o[p.type] = p.value;
  return { y: o.year, m: o.month, d: o.day, h: Number(o.hour) % 24, mi: o.minute, s: o.second };
}

const fmtYmd = (y: string, m: string, d: string) => {
  const f = getPrefs().dateFormat;
  return f === 'iso' ? `${y}-${m}-${d}` : f === 'mdy' ? `${m}/${d}/${y}` : `${d}.${m}.${y}`;
};

const validTs = (ts: number | null | undefined): ts is number => typeof ts === 'number' && Number.isFinite(ts);

/** «13.10.2026» / «10/13/2026» / «2026-10-13» */
export const fmtDate = (ts: number) => {
  if (!validTs(ts)) return '–';
  const z = zoned(ts);
  return fmtYmd(z.y, z.m, z.d);
};

/** «14:05» or «2:05 PM» */
export const fmtTime = (ts: number, seconds = false) => {
  if (!validTs(ts)) return '–';
  const z = zoned(ts);
  const sec = seconds ? `:${z.s}` : '';
  if (getPrefs().timeFormat === '12') {
    const h12 = z.h % 12 === 0 ? 12 : z.h % 12;
    return `${h12}:${z.mi}${sec} ${z.h < 12 ? 'AM' : 'PM'}`;
  }
  return `${String(z.h).padStart(2, '0')}:${z.mi}${sec}`;
};

export const fmtDateTime = (ts: number) => (validTs(ts) ? `${fmtDate(ts)}, ${fmtTime(ts)}` : '–');

/** a plain calendar day "YYYY-MM-DD" (no time zone conversion) in the chosen date format */
export const fmtDay = (day: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? fmtYmd(m[1], m[2], m[3]) : day;
};

/** plural(5, ['сервер', 'сервера', 'серверов']) -> "серверов" */
export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
}

/** a few dots flying out of the centre of the parent (the parent must be `relative`); CSS only */
export function Burst({ count = 8, radius = 17 }: { count?: number; radius?: number }) {
  return (
    <span className="burst" aria-hidden style={{ '--r': `${radius}px` } as CSSProperties}>
      {Array.from({ length: count }, (_, i) => <i key={i} style={{ '--a': `${Math.round((360 / count) * i + 15)}deg` } as CSSProperties} />)}
    </span>
  );
}

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
  const label: Record<Theme, string> = { auto: t('theme.auto'), light: t('theme.light'), dark: t('theme.dark') };
  return (
    <button
      type="button"
      className="btn-icon"
      title={t('theme.title', { name: label[theme] })}
      aria-label={t('theme.aria', { name: label[theme] })}
      onClick={(e) => {
        const t = next[theme];
        // the new theme grows as a circle out of the button (View Transitions); elsewhere it just switches
        const r = e.currentTarget.getBoundingClientRect();
        revealTransition(() => {
          applyTheme(t);
          setTheme(t);
        }, r.left + r.width / 2, r.top + r.height / 2);
      }}
    >
      {theme === 'light' ? <IconSun /> : theme === 'dark' ? <IconMoon /> : <IconAuto />}
    </button>
  );
}

// ---------- building blocks ----------
/**
 * Dialog: a bottom sheet on phones, a centred card on larger screens.
 * Focus moves inside and is trapped, Escape closes, focus returns to the opener, only a real click on the backdrop closes it.
 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // keyboards: first field; touch screens: the dialog itself (no on-screen keyboard popping up)
  useDialogFocus(box, onClose, () =>
    window.matchMedia?.('(pointer: coarse)').matches
      ? box.current
      : box.current?.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? box.current);
  const bd = useBackdropClose(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" {...bd}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="pop panel panel-raised max-h-[92dvh] w-full max-w-lg overflow-auto overscroll-contain rounded-b-none p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] outline-none sm:rounded-b-ui-xl sm:p-6"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} className="min-w-0 text-xl font-black">{title}</h2>
          <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-soft text-mute transition hover:text-ink" onClick={onClose} aria-label={t('common.close')}>
            <IconClose />
          </button>
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

/** `glass`: for use on top of a cover or a gradient (dark translucent capsule, white text, coloured dot) */
export function StatusPill({ online, known, lag, glass = false }: { online: boolean; known: boolean; lag?: boolean; glass?: boolean }) {
  if (glass) {
    const kind = !known ? 'mute' : !online ? 'bad' : lag ? 'lag' : 'ok';
    const text = !known ? 'Ожидание' : !online ? 'Офлайн' : lag ? 'Лаги' : 'Онлайн';
    return <span className={`pill-glass pill-glass-${kind}`}>{text}</span>;
  }
  if (!known) return <span className="pill pill-mute">ОЖИДАНИЕ</span>;
  if (!online) return <span className="pill pill-bad">ОФЛАЙН</span>;
  return lag ? <span className="pill pill-warn lag">ЛАГИ</span> : <span className="pill pill-ok live">ОНЛАЙН</span>;
}

/**
 * `glass`: translucent white square, for use on top of a game-coloured cover.
 * `vtId`: a server id; the avatar of that server morphs between the list tile and the server page (View Transitions).
 */
export function GameAvatar({ game, size = 44, glass = false, vtId }: { game: string; size?: number; glass?: boolean; vtId?: number }) {
  const icon = gameIconPath(game);
  const [c1, c2] = gameGradient(game);
  return (
    <div
      data-vt-avatar={vtId}
      className="grid shrink-0 place-items-center font-black text-white"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: glass ? 'rgba(255,255,255,0.24)' : `linear-gradient(135deg, ${c1}, ${c2})`,
        fontSize: size * 0.34,
        boxShadow: glass ? 'inset 0 0 0 1px rgba(255,255,255,0.25)' : `0 4px 12px -4px ${c1}99`,
      }}
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

// history of a server is shared between remounts (list <-> details) for a couple of minutes
const sparkCache = new Map<number, { at: number; pts: number[] }>();
const SPARK_EVERY = 3 * 60_000;

/**
 * 24h player-count sparkline. Loads its own history, but cheaply: the first request is staggered, it refreshes every 3 minutes,
 * pauses while the tab is hidden and is aborted on unmount. A quiet placeholder is shown until there are two points.
 */
export function Spark({ serverId, color, variant = 'tile' }: { serverId: number; color: string; variant?: 'tile' | 'hero' }) {
  const [pts, setPts] = useState<number[]>(() => sparkCache.get(serverId)?.pts ?? []);

  useEffect(() => {
    let timer = 0;
    let ctl: AbortController | null = null;
    let alive = true;

    const load = async () => {
      if (!alive || document.hidden) return;
      ctl?.abort();
      ctl = new AbortController();
      try {
        const token = getToken();
        const res = await fetch(`/api/servers/${serverId}/history?hours=24`, {
          signal: ctl.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const rows = (await res.json()) as { players: number }[];
        // downsample to at most 48 points
        const step = Math.max(1, Math.ceil(rows.length / 48));
        const next = rows.filter((_, i) => i % step === 0).map((r) => r.players);
        sparkCache.set(serverId, { at: Date.now(), pts: next });
        if (alive) setPts(next);
      } catch {
        /* aborted or offline: keep what we have */
      }
    };
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await load();
        if (alive) schedule(SPARK_EVERY);
      }, delay);
    };

    const cached = sparkCache.get(serverId);
    const age = cached ? Date.now() - cached.at : Infinity;
    // spread the first requests of many cards over ~2.5 s so they do not arrive as one burst
    schedule(age < SPARK_EVERY ? SPARK_EVERY - age : variant === 'hero' ? 0 : 150 + Math.random() * 2500);

    const onVisible = () => {
      if (document.hidden) return;
      const c = sparkCache.get(serverId);
      if (!c || Date.now() - c.at >= SPARK_EVERY) schedule(100 + Math.random() * 1000);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      ctl?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [serverId, variant]);

  if (pts.length < 2) return <div className={`${variant === 'hero' ? 'h-[130px] bg-white/10' : 'h-10 bg-soft/60'} rounded-2xl`} aria-hidden />;
  const label = `Игроков за 24 часа: от ${Math.min(...pts)} до ${Math.max(...pts)}`;
  return variant === 'hero'
    ? <SmoothArea values={pts} color={color} w={560} h={130} grid fill={0.4} strokeWidth={2.6} className="h-[130px]" label={label} />
    : <SmoothArea values={pts} color={color} w={240} h={40} fill={0.25} strokeWidth={2} className="h-10" label={label} />;
}

/** Smooth curve through the points (cubic Bezier with horizontal tangents at the midpoints). */
export function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/**
 * Smooth area chart of a player-count series: gradient fill, line, optional dashed grid and an end dot with a halo.
 * The drawing stretches (preserveAspectRatio none, non-scaling stroke); the dot is an HTML element so it stays round.
 */
export function SmoothArea({
  values, color, w = 240, h = 40, grid = false, dot = true, strokeWidth = 2, fill = 0.28, className = 'h-10', label, max: fixedMax,
}: {
  values: number[]; color: string; w?: number; h?: number; grid?: boolean; dot?: boolean; strokeWidth?: number; fill?: number;
  className?: string; label?: string; max?: number;
}) {
  const gid = useId();
  const pad = 3;
  const max = Math.max(1, fixedMax ?? 0, ...values) * 1.12;
  const pts: [number, number][] = values.map((v, i) => [pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2), h - pad - (v / max) * (h - pad * 2)]);
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];
  return (
    <div className={`relative w-full ${className}`}>
      <svg viewBox={`0 0 ${w} ${h}`} className="chart-reveal absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={fill} />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid && [1, 2, 3].map((k) => (
          <line key={k} x1="0" x2={w} y1={(h / 4) * k} y2={(h / 4) * k} stroke={color} strokeOpacity=".22" strokeDasharray="3 6" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={`${line} L${last[0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {dot && (
        <span
          aria-hidden
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${(last[0] / w) * 100}%`, top: `${(last[1] / h) * 100}%`, background: color, boxShadow: `0 0 0 4px ${color}40` }}
        />
      )}
    </div>
  );
}

/**
 * Page title row: icon, title, subtitle and the page actions on the right (one primary action, the rest soft).
 * `hint`: one sentence under the title (what this page is and why); `help`: longer text behind a «Подробнее» disclosure.
 */
export function PageHead({ title, subtitle, icon, hint, help, children }: { title: string; subtitle?: string; icon?: ReactNode; hint?: ReactNode; help?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const helpId = useId();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          {icon && <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[18px] bg-gradient-to-br from-brand to-brand-2 text-white shadow-pop">{icon}</span>}
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-[-0.025em] sm:text-[30px]">{title}</h1>
            {subtitle && <p className="mt-0.5 font-semibold text-mute">{subtitle}</p>}
          </div>
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
      {(hint || help) && (
        <div className="hint-strip">
          <span aria-hidden className="hint-ico">i</span>
          <div className="min-w-0 flex-1">
            <p>
              {hint}
              {help && (
                <>
                  {hint ? ' ' : ''}
                  <button type="button" className="hint-more" aria-expanded={open} aria-controls={helpId} onClick={() => setOpen((v) => !v)}>
                    {open ? 'Скрыть' : 'Подробнее'}
                  </button>
                </>
              )}
            </p>
            {help && open && <div id={helpId} className="hint-help">{help}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** a link with the arrow used for "go to that section" hints */
export function GoLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} className={`inline-flex items-center gap-1 font-extrabold text-link hover:underline ${className}`}>
      {children}
      <span aria-hidden>→</span>
    </a>
  );
}

/** a coloured strip with a message and an optional action (usually a GoLink) */
export function Notice({ tone = 'warn', children, action, role }: { tone?: 'warn' | 'info' | 'bad'; children: ReactNode; action?: ReactNode; role?: 'status' | 'alert' }) {
  const cls = tone === 'bad' ? 'bg-badbg text-bad' : tone === 'info' ? 'bg-soft text-ink' : 'bg-warnbg text-warn';
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl px-4 py-2.5 text-sm font-bold ${cls}`} role={role ?? (tone === 'bad' ? 'alert' : 'status')}>
      <span className="min-w-0 flex-1 basis-60">{children}</span>
      {action && <span className="shrink-0 [&_a]:text-current [&_a]:underline">{action}</span>}
    </div>
  );
}

export function ErrorLine({ text }: { text: string }) {
  return text ? <p className="rounded-2xl bg-badbg px-4 py-2.5 font-bold text-bad" role="alert">{text}</p> : null;
}

/** an empty list: the «empty» variant of StateView (kept under its old name, every page uses it) */
export function Empty({ title, text, art, children }: { title: string; text: string; art?: ReactNode; children?: ReactNode }) {
  return <StateView kind="empty" title={title} text={text} art={art}>{children}</StateView>;
}

/** Copies text to the clipboard; falls back to a dialog with the text selected where the Clipboard API is blocked. */
export function CopyButton({ text, label = 'Копировать', className = '', tone = 'soft' }: { text: string; label?: string; className?: string; tone?: 'soft' | 'grad' | 'glass' }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1500);
    } catch {
      await promptDialog({ title: 'Скопируйте вручную', label: 'Текст', value: text, readOnly: true });
    }
  };
  return (
    <button type="button" className={`${tone === 'grad' ? 'btn-on-grad' : tone === 'glass' ? 'btn-glass' : 'btn btn-soft btn-sm'} ${className}`} onClick={copy} title={label}>
      <span className="copy-ico" data-done={done} aria-hidden>
        <span className="ico-copy inline-grid"><IconCopy /></span>
        <svg className="ico-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.500" />
        </svg>
        {done && <Burst />}
      </span>
      <span aria-live="polite">{done ? 'Скопировано' : label}</span>
    </button>
  );
}

/** The CoreGSM mark (a "C" whose three lights use the status colours). Source art lives in public/. */
export function Logo({ size = 32, alt }: { size?: number; alt?: string }) {
  const { brand } = useAuth().access;
  return (
    <img
      src={brand.hasLogo ? `/api/branding/logo?v=${brand.logoV}` : '/logo-128.png'}
      width={size}
      height={size}
      // pass alt="" when the name is written next to the logo; alone it is described by the community name
      alt={alt ?? brand.name}
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
/** an action button in a toast: `onClick` (undo and the like; the toast closes after it) or `href` (a link in a new tab) */
export interface ToastAction { label: string; onClick?: () => void; href?: string }
export interface ToastOptions {
  kind?: ToastKind;
  /** how long it stays, ms (default 3.5 s; 8 s for errors and links; 6 s when there is an action button) */
  duration?: number;
  action?: ToastAction;
  /** called once when the toast goes away: 'action' (its button was pressed), 'dismiss' (closed by hand), 'timeout' */
  onClose?: (reason: 'action' | 'dismiss' | 'timeout') => void;
}
interface ToastItem { id: number; text: string; kind: ToastKind; leaving?: boolean; action?: ToastAction; duration: number; onClose?: ToastOptions['onClose'] }
let toasts: ToastItem[] = [];
let toastSeq = 0;
const toastTimers = new Map<number, number>();
const toastListeners = new Set<(t: ToastItem[]) => void>();
const emitToasts = () => toastListeners.forEach((l) => l(toasts));

const armToast = (id: number, ms: number) => {
  window.clearTimeout(toastTimers.get(id));
  toastTimers.set(id, window.setTimeout(() => dismissToast(id, 'timeout'), ms));
};

/**
 * Shows a toast.
 *   toast('Сохранено')                                   // green
 *   toast('Не удалось', 'err')                           // red, stays longer
 *   toast('Удалено', { action: { label: 'Отменить', onClick: undo }, duration: 6000 })
 * The old positional form toast(text, kind, ms, { label, href }) keeps working. Returns the toast id.
 */
export function toast(text: string, kindOrOptions: ToastKind | ToastOptions = 'ok', ms?: number, action?: ToastAction): number {
  const o: ToastOptions = typeof kindOrOptions === 'string' ? { kind: kindOrOptions, duration: ms, action } : kindOrOptions;
  const kind = o.kind ?? 'ok';
  const duration = o.duration ?? (kind === 'err' ? 8000 : o.action?.onClick ? 6000 : o.action ? 8000 : 3500);
  const t: ToastItem = { id: ++toastSeq, text, kind, action: o.action, duration, onClose: o.onClose };
  const next = [...toasts, t];
  // the oldest ones are pushed out: they count as timed out, so a pending "delete after the undo window" still happens
  const evicted = next.slice(0, Math.max(0, next.length - 4));
  toasts = next.slice(-4);
  evicted.forEach((e) => { window.clearTimeout(toastTimers.get(e.id)); toastTimers.delete(e.id); e.onClose?.('timeout'); });
  emitToasts();
  armToast(t.id, duration);
  return t.id;
}

export function dismissToast(id: number, reason: 'action' | 'dismiss' | 'timeout' = 'dismiss') {
  const t = toasts.find((x) => x.id === id);
  if (!t || t.leaving) return;
  window.clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
  // it springs out first (about 200 ms), then it is removed
  toasts = toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x));
  emitToasts();
  t.onClose?.(reason);
  window.setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id);
    emitToasts();
  }, 200);
}

/**
 * «Удалено. Отменить»: the caller hides the item at once and passes `commit` (the real, irreversible request).
 * `commit` runs when the toast times out or is closed by hand, and also when the page is left; it does not run
 * after «Отменить», which calls `restore`. Use it only where the removal can wait a few seconds without harm.
 */
export function undoable({ text, commit, restore, duration = 6000, label = 'Отменить' }: { text: string; commit: () => unknown; restore: () => void; duration?: number; label?: string }) {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    window.removeEventListener('pagehide', finish);
    void commit();
  };
  window.addEventListener('pagehide', finish);
  toast(text, {
    duration,
    action: { label, onClick: () => { if (settled) return; settled = true; window.removeEventListener('pagehide', finish); restore(); } },
    onClose: (reason) => { if (reason !== 'action') finish(); },
  });
}

/**
 * Two sibling live regions (never nested): errors are announced assertively (role=alert), the rest politely.
 * They sit above the phone navigation bar and the home-indicator safe area. A toast with an action stops its timer
 * while the pointer or the keyboard focus is on it.
 */
export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(toasts);
  useEffect(() => {
    toastListeners.add(setList);
    return () => { toastListeners.delete(setList); };
  }, []);
  const tone = { ok: 'bg-okbg text-ok ring-ok/25', err: 'bg-badbg text-bad ring-bad/30', info: 'bg-raised text-ink ring-line' } as const;
  const kindIcon = { ok: <IconOk size={18} />, err: <IconError size={18} />, info: <IconInfo size={18} /> };
  const hold = (t: ToastItem) => { if (t.action?.onClick) window.clearTimeout(toastTimers.get(t.id)); };
  const release = (t: ToastItem) => { if (t.action?.onClick && !t.leaving) armToast(t.id, Math.min(t.duration, 4000)); };
  const item = (t: ToastItem) => (
    <div
      key={t.id}
      onPointerEnter={() => hold(t)}
      onPointerLeave={() => release(t)}
      onFocusCapture={() => hold(t)}
      onBlurCapture={() => release(t)}
      className={`${t.leaving ? 'toast-out' : 'toast-in'} pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-ui-lg py-2 pl-3.5 pr-2 text-sm font-bold shadow-3 ring-1 max-sm:max-w-full ${tone[t.kind]}`}
    >
      <span aria-hidden className="shrink-0">{kindIcon[t.kind]}</span>
      <span className="min-w-0 flex-1 break-words py-1">{t.text}</span>
      {t.action?.href && <a href={t.action.href} target="_blank" rel="noreferrer" className="shrink-0 rounded-full px-2 py-1 font-extrabold underline">{t.action.label}</a>}
      {t.action?.onClick && (
        <button
          type="button"
          onClick={() => { t.action?.onClick?.(); dismissToast(t.id, 'action'); }}
          className="shrink-0 rounded-full bg-ink/10 px-3 py-1.5 font-extrabold hover:underline max-sm:min-h-[44px]"
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismissToast(t.id, 'dismiss')}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full opacity-80 hover:opacity-100 max-sm:h-11 max-sm:w-11"
        aria-label={tr('toast.close')}
      >
        <IconClose size={14} />
      </button>
    </div>
  );
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-[90] flex flex-col items-center gap-2 md:inset-x-auto md:bottom-6 md:right-6 md:items-end">
      <div aria-live="polite" className="flex w-full flex-col items-center gap-2 md:items-end">{list.filter((t) => t.kind !== 'err').map(item)}</div>
      <div role="alert" className="flex w-full flex-col items-center gap-2 md:items-end">{list.filter((t) => t.kind === 'err').map(item)}</div>
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
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden p-4 pt-20 sm:p-8">
      <AuthDecor />
      <div className="absolute right-4 top-4 z-10"><ThemeToggle /></div>
      <div className="relative z-[1] grid w-full max-w-6xl items-center justify-items-center gap-10 xl:grid-cols-[minmax(0,1fr)_24rem_minmax(0,1fr)]">
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
      <Wordmark className="mt-2 max-w-full break-words text-3xl" />
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
    <div className="auth-card w-full max-w-sm rounded-[28px] border bg-card/90 p-6 backdrop-blur sm:p-7">
      <AuthBrand subtitle={mode === 'login' ? t('auth.subLogin') : t('auth.subRegister')} />
      {access.registration && (
        <nav className="seg mb-5 flex w-full" aria-label={t('auth.switchAria')}>
          {tabs.map((t) => (
            <a
              key={t.id}
              href={`#/${t.id}`}
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
        <p className="mt-5 text-center text-sm font-bold"><a href="#/servers" className="inline-flex items-center text-link hover:underline max-sm:min-h-[44px]">{t('auth.guest')}</a></p>
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
          className="input !pr-12 max-sm:!pr-14"
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
          className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-mute transition hover:text-ink max-sm:h-11 max-sm:w-11"
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
      className={`grid shrink-0 place-items-center rounded-[30%] font-black ${tone === 'brand' ? 'bg-brand text-white' : tone === 'grad' ? 'bg-gradient-to-br from-brand to-[#ec4899] text-white' : 'bg-soft text-link'} ${className}`}
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

// ---------- admin page grid: one rhythm for every page of the admin area ----------
export { useAutosave } from './autosave';
export type { SaveStatus, AutosaveOptions } from './autosave';
import type { SaveStatus } from './autosave';

/**
 * Root of an admin page: PageHead first, then sections 20 px apart. `narrow` (forms: settings, alerts) caps the
 * content at 48rem; the PageHead always spans the full width, so titles sit at the same place on every page.
 */
export function AdminPage({ head, narrow = false, children }: { head: ReactNode; narrow?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-5">
      {head}
      <div className={`space-y-5 ${narrow ? 'max-w-3xl' : ''}`}>{children}</div>
    </div>
  );
}

/**
 * The section card of the admin pages: a panel with a title (h2), an optional description and optional actions on the
 * right of the title. Padding is p-5 on phones and p-6 from sm, so the compact density and the 400 px width stay consistent.
 */
export function Section({ title, description, actions, children, className = '', id, tone = 'panel', ...rest }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; id?: string;
  tone?: 'panel' | 'soft'; 'data-tour'?: string;
}) {
  const hid = useId();
  return (
    <section id={id} aria-labelledby={title ? hid : undefined} className={`${tone === 'soft' ? 'rounded-ui-lg bg-soft p-4' : 'panel p-5 sm:p-6'} space-y-4 ${className}`} {...rest}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-56">
            {title && <h2 id={hid} className={`${tone === 'soft' ? 'text-base' : 'text-lg'} font-black`}>{title}</h2>}
            {description && <p className="mt-0.5 font-semibold text-mute">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** a slim one-line card (channel pickers, toolbars): same panel, tighter padding */
export function Strip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`panel flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 ${className}`}>{children}</div>;
}

/** «Сохраняется… / Сохранено / Не сохранено»: the state of an autosaved field; `retry` shows «Повторить» after a failure */
export function SaveBadge({ status, error, retry }: { status: SaveStatus; error?: string; retry?: () => void }) {
  let body: ReactNode = null;
  if (status === 'dirty') body = <span className="text-mute">Изменено…</span>;
  else if (status === 'saving') body = <span className="inline-flex items-center gap-1.5 text-mute"><Spinner className="h-3.5 w-3.5" />Сохраняется…</span>;
  else if (status === 'saved') body = <span className="inline-flex items-center gap-1.5 text-ok"><IconCheck size={14} />Сохранено</span>;
  else if (status === 'error') {
    body = (
      <span className="inline-flex flex-wrap items-center gap-x-2 text-bad">
        Не сохранено{error ? `: ${error}` : ''}
        {retry && <button type="button" className="font-extrabold underline" onClick={retry}>Повторить</button>}
      </span>
    );
  }
  return <span className="min-h-[1.25rem] text-sm font-bold" role={status === 'error' ? 'alert' : 'status'} aria-live="polite">{body}</span>;
}

/**
 * Label + input + message under the field. `error` (validation) is red and replaces the hint; `save` shows the
 * autosave state on the label row. Pass the rest of the input attributes through.
 */
export function TextField({ id, label, value, onChange, error, hint, save, className = '', multiline = false, ...rest }: {
  id: string; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: ReactNode;
  save?: { status: SaveStatus; error?: string; retry?: () => void }; className?: string; multiline?: boolean;
  type?: string; placeholder?: string; maxLength?: number; disabled?: boolean; autoComplete?: string; rows?: number;
  onBlur?: () => void; inputMode?: 'text' | 'url' | 'numeric'; spellCheck?: boolean;
}) {
  const describedBy = [error ? `${id}-err` : '', hint && !error ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    className: `input ${className}`,
    value,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    ...rest,
  };
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
        <label htmlFor={id} className="text-sm font-extrabold text-mute">{label}</label>
        {save && <SaveBadge status={save.status} error={save.error} retry={save.retry} />}
      </div>
      {multiline ? <textarea {...common} /> : <input {...common} />}
      <FieldError id={`${id}-err`} text={error} />
      {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-sm font-semibold text-mute">{hint}</p>}
    </div>
  );
}
