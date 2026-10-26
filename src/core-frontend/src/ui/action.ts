import { useCallback, useRef, useState } from 'react';
import { t } from '../i18n';
import { toast } from './toast';

/** The text of an error for people: the message of an Error (the server's own wording for ApiError), otherwise a generic line. */
export function errText(e: unknown, fallback?: string): string {
  const m = e instanceof Error ? e.message.trim() : typeof e === 'string' ? e.trim() : '';
  return m || fallback || t('common.error');
}

/** Shows a failure as a toast. The one place that decides how a failed action is announced outside a form. */
export function fail(e: unknown, prefix?: string): void {
  const m = errText(e);
  toast(prefix ? `${prefix} ${m}` : m, 'err');
}

/**
 * Runs an async action with a busy flag and an error line, so a screen does not repeat try/catch/finally:
 *   const { run, busy, error } = useAction();
 *   <Button loading={busy} onClick={() => run(save, { ok: t('common.saved') })}>…</Button>  <ErrorLine text={error} />
 * `toastError` shows the failure as a toast instead of the error line. Returns true when the action succeeded.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(0);
  const run = useCallback(async (fn: () => Promise<unknown>, o: { ok?: string; toastError?: boolean } = {}): Promise<boolean> => {
    const id = ++live.current;
    setBusy(true);
    setError('');
    try {
      await fn();
      if (o.ok) toast(o.ok, 'ok');
      return true;
    } catch (e) {
      if (o.toastError) fail(e);
      else if (id === live.current) setError(errText(e));
      return false;
    } finally {
      if (id === live.current) setBusy(false);
    }
  }, []);
  return { run, busy, error, clear: () => setError('') };
}
