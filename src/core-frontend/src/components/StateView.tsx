import type { ReactNode } from 'react';
import { ApiError } from '../api';
import { t } from '../i18n';
import { Icon, IconError, IconInfo, IconSearch, IconShield } from '../icons';
import { useAppearance } from '../appearance';

/**
 * One family of «nothing here» screens: empty list, load error (with «Повторить»), no access, not found, no connection.
 * Same card, same icon tile, same title / text / primary action everywhere; only the colour and the default wording differ.
 * Defaults come from the i18n keys state.<kind>.title / state.<kind>.text; pass `title` / `text` for page-specific words.
 */
export type StateKind = 'empty' | 'error' | 'forbidden' | 'notfound' | 'offline';

const IconOffline = ({ size = 28 }: { size?: number }) => (
  <Icon size={size}><path d="M3 3l18 18M5 12.5a10 10 0 0 1 3.3-2.2M10.6 6.2A14 14 0 0 1 22 10M8.5 16a5 5 0 0 1 5.6-1.2M12 20h.01" /></Icon>
);

/** the Ember look: a warm ember in a soft round, instead of the icon tile (empty lists and not-found pages) */
export function EmberArt() {
  return (
    <svg className="state-ember" width="84" height="84" viewBox="0 0 84 84" fill="none" aria-hidden>
      <circle cx="42" cy="44" r="34" fill="currentColor" opacity=".1" />
      <circle cx="42" cy="44" r="23" fill="currentColor" opacity=".14" />
      <path d="M42 20c3 9 12 13 12 25a12 12 0 0 1-24 0c0-6 3-9 6-13 1 4 3 6 5 7-1-7-1-13 1-19z" fill="currentColor" />
      <circle cx="20" cy="26" r="2.500" fill="currentColor" opacity=".5" />
      <circle cx="66" cy="20" r="2" fill="currentColor" opacity=".4" />
      <circle cx="68" cy="58" r="3" fill="currentColor" opacity=".3" />
    </svg>
  );
}

const TILE: Record<StateKind, string> = {
  empty: 'bg-soft text-link',
  error: 'bg-badbg text-bad',
  forbidden: 'bg-warnbg text-warn',
  notfound: 'bg-soft text-mute',
  offline: 'bg-warnbg text-warn',
};

function KindIcon({ kind }: { kind: StateKind }) {
  if (kind === 'error') return <IconError size={28} />;
  if (kind === 'forbidden') return <IconShield size={28} />;
  if (kind === 'notfound') return <IconSearch size={28} />;
  if (kind === 'offline') return <IconOffline />;
  return <IconInfo size={28} />;
}

export function StateView({
  kind = 'empty', title, text, art, onRetry, retryLabel, action, compact = false, bare = false, className = '', heading = 'h3', children,
}: {
  kind?: StateKind;
  title?: string;
  text?: string;
  /** an illustration instead of the icon tile (empty lists keep their pictures) */
  art?: ReactNode;
  /** shows «Повторить» (default for error and offline states) */
  onRetry?: () => void;
  retryLabel?: string;
  /** the primary action: a button or a link */
  action?: ReactNode;
  compact?: boolean;
  /** no card around it: for use inside another card */
  bare?: boolean;
  className?: string;
  /** the heading level: h1 when the state fills a whole page */
  heading?: 'h1' | 'h2' | 'h3';
  children?: ReactNode;
}) {
  const [{ ember }] = useAppearance();
  const head = title ?? t(`state.${kind}.title`);
  const body = text ?? t(`state.${kind}.text`);
  const alert = kind === 'error' || kind === 'forbidden';
  const H = heading;
  return (
    <div
      className={`${bare ? '' : 'panel'} fade-in flex flex-col items-center gap-2 px-6 text-center ${compact ? 'py-6' : 'py-10'} ${className}`}
      role={alert ? 'alert' : 'status'}
      data-state={kind}
    >
      {/* the Ember look: every empty list has the same picture (an ember), the pages that bring their own art (404) keep it */}
      {(ember && kind === 'empty' ? null : art) ?? (ember && (kind === 'empty' || kind === 'notfound') ? <div className="mb-1 text-link"><EmberArt /></div> : <div className={`mb-1 grid h-14 w-14 place-items-center rounded-3xl ${TILE[kind]}`}><KindIcon kind={kind} /></div>)}
      <H className={heading === 'h1' ? 'text-2xl font-extrabold tracking-[-0.02em]' : 'text-lg font-black'}>{head}</H>
      {body && <p className="max-w-sm font-semibold text-mute">{body}</p>}
      {(onRetry || action || children) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">
          {action}
          {onRetry && <button type="button" className={`btn ${action ? 'btn-soft' : ''}`} onClick={onRetry}>{retryLabel ?? t('common.retry')}</button>}
          {children}
        </div>
      )}
    </div>
  );
}

const NETWORK_RE = /failed to fetch|networkerror|network request failed|load failed|network error|нет связи/i;

/** which state a failed request deserves: no connection, no rights, or a plain error */
export function errorKind(error: unknown): StateKind {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (error instanceof ApiError) return error.status === 403 ? 'forbidden' : 'error';
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (error instanceof TypeError || NETWORK_RE.test(msg)) return 'offline';
  return 'error';
}

/** a failed page load as a StateView: the kind follows the error, the server's own message is shown as the text */
export function LoadError({ error, onRetry, compact, bare, title }: { error: unknown; onRetry?: () => void; compact?: boolean; bare?: boolean; title?: string }) {
  const kind = errorKind(error);
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const own = kind === 'error' && msg ? msg : undefined;
  return <StateView kind={kind} title={title} text={own} onRetry={kind === 'forbidden' ? undefined : onRetry} compact={compact} bare={bare} />;
}
