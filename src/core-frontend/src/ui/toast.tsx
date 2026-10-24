/** Toasts: short confirmations that do not interrupt, with an optional undo. */
import { useEffect, useState } from 'react';
import { t as tr } from '../i18n';
import { IconClose, IconError, IconInfo, IconOk } from '../icons';

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
      <span className="min-w-0 flex-1 wrap-break-word py-1">{t.text}</span>
      {t.action?.href && <a href={t.action.href} target="_blank" rel="noreferrer" className="btn-ghost btn-tone btn-xs shrink-0">{t.action.label}</a>}
      {t.action?.onClick && (
        <button
          type="button"
          onClick={() => { t.action?.onClick?.(); dismissToast(t.id, 'action'); }}
          className="btn-ghost btn-tone btn-xs shrink-0"
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismissToast(t.id, 'dismiss')}
        className="btn-icon-ghost btn-icon-sm btn-tone shrink-0"
        aria-label={tr('toast.close')}
      >
        <IconClose size={14} />
      </button>
    </div>
  );
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-90 flex flex-col items-center gap-2 md:inset-x-auto md:bottom-6 md:right-6 md:items-end">
      <div aria-live="polite" className="flex w-full flex-col items-center gap-2 md:items-end">{list.filter((t) => t.kind !== 'err').map(item)}</div>
      <div role="alert" className="flex w-full flex-col items-center gap-2 md:items-end">{list.filter((t) => t.kind === 'err').map(item)}</div>
    </div>
  );
}
