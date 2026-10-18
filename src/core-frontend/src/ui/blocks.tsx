/** Building blocks shared by the pages: dialogs, fields, pills, avatars, notices, copy buttons, logo. */
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { StateView } from '../components/StateView';
import { promptDialog, useBackdropClose, useDialogFocus } from '../confirm';
import { gameIconPath } from '../gameIcons';
import { GAME_IMAGE, gameAbbr, gameGradient } from '../games';
import { t } from '../i18n';
import { IconClose, IconCopy } from '../icons';
import { Burst } from './motion';
import { noAutofill } from './noAutofill';

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
          <button type="button" className="btn-icon" onClick={onClose} aria-label={t('common.close')}>
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
export function StatusPill({ online, known, lag, glass = false, maintenance = false }: { online: boolean; known: boolean; lag?: boolean; glass?: boolean; maintenance?: boolean }) {
  // a window of maintenance explains the silence: neither «Офлайн» nor «Лаги»
  if (maintenance) return glass ? <span className="pill-glass pill-glass-maint">Обслуживание</span> : <span className="pill pill-maint">ОБСЛУЖИВАНИЕ</span>;
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
        // artwork sits on a deep tile of the game colour (as on the PNG card), a line pictogram on the colour itself
        background: glass
          ? 'rgba(255,255,255,0.24)'
          : GAME_IMAGE[game]
            ? `linear-gradient(135deg, color-mix(in srgb, ${c1} 55%, #000), color-mix(in srgb, ${c2} 25%, #000))`
            : `linear-gradient(135deg, ${c1}, ${c2})`,
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

/**
 * Page title row: icon, title, subtitle and the page actions on the right (one primary action, the rest soft).
 * `hint`: one sentence under the title (what this page is and why); `help`: longer text behind a «Подробнее» disclosure.
 */
export function PageHead({ title, subtitle, icon, hint, help, children }: { title: string; subtitle?: string; icon?: ReactNode; hint?: ReactNode; help?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const helpId = useId();
  // a hint is read once: the cross hides it (remembered per page in this browser), the «i» button next to the actions brings it back
  const hintKey = `coregsm_hint_${title}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(hintKey) === '1'; } catch { return false; } });
  const setHint = (off: boolean) => { setHidden(off); try { if (off) localStorage.setItem(hintKey, '1'); else localStorage.removeItem(hintKey); } catch { /* not remembered */ } };
  const hasHint = !!(hint || help);
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
        {(children || (hasHint && hidden)) && (
          <div className="flex flex-wrap items-center gap-2">
            {hasHint && hidden && <button type="button" className="btn-icon-ghost btn-icon-sm" title="Показать подсказку" aria-label="Показать подсказку" onClick={() => setHint(false)}><span aria-hidden className="hint-ico">i</span></button>}
            {children}
          </div>
        )}
      </div>
      {hasHint && !hidden && (
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
          <button type="button" className="hint-close" aria-label="Скрыть подсказку" title="Скрыть подсказку" onClick={() => setHint(true)}>✕</button>
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
    <button type="button" className={`${tone === 'grad' ? 'btn-on-grad btn-sm' : tone === 'glass' ? 'btn-glass btn-sm' : 'btn btn-soft btn-sm'} ${className}`} onClick={copy} title={label}>
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
          {...noAutofill()}
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

/** a few grey rows while a list loads: the page keeps its shape instead of jumping when the data comes */
export function SkeletonRows({ n = 3, h = 'h-14' }: { n?: number; h?: string }) {
  return (
    <div className="grid gap-2" aria-busy="true" role="status" aria-label="Загрузка">
      {Array.from({ length: n }, (_, i) => <div key={i} className={`skeleton ${h} rounded-2xl`} style={{ opacity: 1 - i * 0.18 }} />)}
    </div>
  );
}
