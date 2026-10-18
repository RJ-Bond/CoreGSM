import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'dirty' | 'invalid' | 'saving' | 'saved' | 'error';

export interface AutosaveOptions<V> {
  /** the current value of the field(s) in the form */
  value: V;
  /** the value the server has right now; while the user has no unsaved edit, the baseline follows it */
  saved: V;
  /** returns an error text while the value must not be sent (the message is shown under the field) */
  validate?: (v: V) => string | null;
  /** sends the value; throw to report a failure (the text of the error is shown, the edit stays in the form) */
  save: (v: V) => Promise<unknown>;
  /** wait after the last keystroke, ms */
  delay?: number;
  /** false: nothing is sent (the form is not loaded yet) */
  enabled?: boolean;
  equal?: (a: V, b: V) => boolean;
  /** true: nothing is sent by itself (no pause timer, no send on leaving); a common bar calls saveNow() */
  manual?: boolean;
}

const sameJson = <V,>(a: V, b: V) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Autosave for a form field or a small group of fields.
 *  - valid and changed: saves after `delay` of silence, or at once on `flush()` (call it from onBlur)
 *  - invalid: nothing is sent, `error` holds the message to show under the field
 *  - the request fails: the value stays in the form, `status` is 'error' and `retry()` tries again (no silent loss)
 *  - edits made while a request is in flight are sent after it, never dropped
 *  - leaving the page (unmount) with a valid unsaved edit sends it once more
 */
export function useAutosave<V>({ value, saved, validate, save, delay = 900, enabled = true, equal = sameJson, manual = false }: AutosaveOptions<V>) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState('');
  const baseline = useRef(saved);
  const latest = useRef(value);
  const inflight = useRef(false);
  const timer = useRef(0);
  const fade = useRef(0);
  const opts = useRef({ validate, save, equal, enabled, manual });
  opts.current = { validate, save, equal, enabled, manual };
  latest.current = value;

  const validation = validate ? validate(value) : null;
  const dirty = !equal(value, baseline.current);

  const run = useCallback(async () => {
    window.clearTimeout(timer.current);
    const o = opts.current;
    const v = latest.current;
    if (!o.enabled || inflight.current || o.equal(v, baseline.current) || o.validate?.(v)) return;
    inflight.current = true;
    setStatus('saving');
    setError('');
    try {
      await o.save(v);
      baseline.current = v;
      setStatus('saved');
      window.clearTimeout(fade.current);
      fade.current = window.setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 2500);
    } catch (e) {
      setStatus('error');
      setError((e as Error).message || 'Не удалось сохранить');
      inflight.current = false;
      return;
    }
    inflight.current = false;
    // something was typed during the request
    if (!opts.current.equal(latest.current, baseline.current) && !opts.current.validate?.(latest.current)) {
      timer.current = window.setTimeout(() => void run(), 250);
    }
  }, []);

  // the server value changed (a reload): take it as the new baseline unless the user has an unsaved edit
  useEffect(() => {
    if (!equal(saved, baseline.current) && equal(latest.current, baseline.current)) baseline.current = saved;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!opts.current.enabled) return;
    if (equal(value, baseline.current)) {
      // an edit taken back (or discarded from a bar) is not an error any more
      setStatus((s) => (s === 'saved' || s === 'saving' || (s === 'error' && !manual) ? s : 'idle'));
      return;
    }
    if (validate?.(value)) { setStatus('invalid'); return; }
    if (inflight.current) return;
    setStatus('dirty');
    setError('');
    if (manual) return undefined;
    timer.current = window.setTimeout(() => void run(), delay);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delay, enabled]);

  // leaving with an unsaved, valid edit: send it
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    window.clearTimeout(fade.current);
    const o = opts.current;
    if (!o.manual && o.enabled && !inflight.current && !o.equal(latest.current, baseline.current) && !o.validate?.(latest.current)) void o.save(latest.current).catch(() => undefined);
  }, []);

  return {
    status: validation && dirty ? ('invalid' as SaveStatus) : status,
    /** message of the failed request, or of the validation when the value is invalid */
    error: validation && dirty ? validation : error,
    /** validation message even when nothing was edited yet is not shown: only a changed value is judged */
    invalid: !!validation && dirty,
    /** send now (onBlur); in manual mode leaving a field sends nothing */
    flush: () => { if (!opts.current.manual) void run(); },
    retry: () => void run(),
    /** send now, whatever the mode (the button of a common bar); resolves when the request is over */
    saveNow: () => run(),
  };
}
