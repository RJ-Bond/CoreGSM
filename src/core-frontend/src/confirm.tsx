import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type RefObject } from 'react';

/**
 * Styled replacements for window.confirm / window.prompt.
 *   if (!(await confirmDialog({ title: 'Удалить сервер?', text: '…', confirmLabel: 'Удалить', danger: true }))) return;
 *   const pw = await promptDialog({ title: 'Новый пароль', label: 'Пароль', password: true });   // null = cancelled
 * <ConfirmHost /> must be mounted once (App.tsx does it). Several calls at once are queued and shown one after another.
 * Without a mounted host the browser's own dialogs are used, so a call never hangs.
 */

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** red confirm button, focus starts on "Отмена" */
  danger?: boolean;
}
export interface PromptOptions extends ConfirmOptions {
  label: string;
  value?: string;
  placeholder?: string;
  password?: boolean;
  /** show the value only to copy it: the text is selected, there is no cancel button */
  readOnly?: boolean;
  /** returns an error text to keep the dialog open */
  validate?: (v: string) => string | null;
}

type Req =
  | { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

let push: ((r: Req) => void) | null = null;
let seq = 0;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) return resolve(window.confirm(`${opts.title}${opts.text ? `\n\n${opts.text}` : ''}`));
    push({ id: ++seq, kind: 'confirm', opts, resolve });
  });
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    if (!push) return resolve(window.prompt(opts.label, opts.value ?? ''));
    push({ id: ++seq, kind: 'prompt', opts, resolve });
  });
}

// ---------- shared dialog behaviour (also used by Modal in ui.tsx) ----------
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const stack: HTMLElement[] = [];
let scrollLocks = 0;

/**
 * Focus management for a modal dialog: moves focus inside, keeps Tab in the dialog, closes on Escape (only the topmost dialog),
 * locks page scroll and gives focus back to the element that opened the dialog.
 */
export function useDialogFocus(box: RefObject<HTMLElement>, onEscape: () => void, initialFocus?: () => HTMLElement | null | undefined) {
  const esc = useRef(onEscape);
  esc.current = onEscape;
  const init = useRef(initialFocus);
  init.current = initialFocus;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;
    stack.push(el);
    if (++scrollLocks === 1) document.body.style.overflow = 'hidden';

    if (!el.contains(document.activeElement)) {
      const first = init.current?.() ?? el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el;
      first.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== el) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        esc.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) { e.preventDefault(); el.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !el.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !el.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const i = stack.indexOf(el);
      if (i >= 0) stack.splice(i, 1);
      if (--scrollLocks <= 0) { scrollLocks = 0; document.body.style.overflow = ''; }
      // the opener may be gone (e.g. the row was deleted): then focus simply stays where the browser puts it
      if (opener && document.contains(opener)) opener.focus?.();
    };
  }, [box]);
}

/** a click that starts AND ends on the backdrop itself closes the dialog; a text selection dragged out of it does not */
export function useBackdropClose(close: () => void) {
  const down = useRef(false);
  const fn = useRef(close);
  fn.current = close;
  return {
    onMouseDown: (e: MouseEvent<HTMLElement>) => { down.current = e.target === e.currentTarget; },
    onMouseUp: (e: MouseEvent<HTMLElement>) => {
      if (down.current && e.target === e.currentTarget) fn.current();
      down.current = false;
    },
  };
}

export function ConfirmHost() {
  const [req, setReq] = useState<Req | null>(null);
  const current = useRef<Req | null>(null);
  const queue = useRef<Req[]>([]);

  useEffect(() => {
    push = (r) => {
      if (current.current) queue.current.push(r);
      else { current.current = r; setReq(r); }
    };
    return () => {
      push = null;
      // unmounting with dialogs open: answer "no" so no caller waits forever
      const pending = [current.current, ...queue.current].filter((x): x is Req => !!x);
      current.current = null;
      queue.current = [];
      pending.forEach((r) => (r.kind === 'confirm' ? r.resolve(false) : r.resolve(null)));
    };
  }, []);

  const done = () => {
    current.current = queue.current.shift() ?? null;
    setReq(current.current);
  };

  if (!req) return null;
  return <Dialog key={req.id} req={req} onDone={done} />;
}

function Dialog({ req, onDone }: { req: Req; onDone: () => void }) {
  const box = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(req.kind === 'prompt' ? (req.opts.value ?? '') : '');
  const [error, setError] = useState('');
  const closed = useRef(false);
  const o = req.opts;
  const readOnly = req.kind === 'prompt' && !!req.opts.readOnly;

  const finish = (ok: boolean) => {
    if (closed.current) return;
    closed.current = true;
    if (req.kind === 'confirm') req.resolve(ok);
    else req.resolve(ok ? value : null);
    onDone();
  };

  // prompt: the field; destructive confirm: the safe button (cancel); otherwise the OK button
  useDialogFocus(box, () => finish(false), () => {
    const el = box.current;
    if (!el) return null;
    if (input.current) {
      if (readOnly) input.current.select();
      return input.current;
    }
    return el.querySelector<HTMLElement>(o.danger ? '[data-cancel]' : '[data-ok]');
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (req.kind === 'prompt' && req.opts.validate) {
      const msg = req.opts.validate(value);
      if (msg) { setError(msg); input.current?.focus(); return; }
    }
    finish(true);
  };

  const bd = useBackdropClose(() => finish(false));

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      {...bd}
    >
      <form
        ref={box}
        tabIndex={-1}
        role={req.kind === 'confirm' && o.danger ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="cd-title"
        aria-describedby={o.text ? 'cd-text' : undefined}
        onSubmit={submit}
        className="pop panel max-h-[92dvh] w-full max-w-md space-y-4 overflow-auto rounded-b-none p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] outline-none sm:rounded-b-3xl sm:pb-6"
      >
        <h2 id="cd-title" className="text-xl font-black">{o.title}</h2>
        {o.text && <p id="cd-text" className="whitespace-pre-line font-semibold text-mute">{o.text}</p>}
        {req.kind === 'prompt' && (
          <div>
            <label htmlFor="cd-input" className="label">{req.opts.label}</label>
            <input
              id="cd-input"
              ref={input}
              className={`input ${readOnly ? 'font-mono' : ''}`}
              type={req.opts.password ? 'password' : 'text'}
              value={value}
              readOnly={readOnly}
              placeholder={req.opts.placeholder}
              autoComplete={req.opts.password ? 'new-password' : 'off'}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'cd-err' : undefined}
              onFocus={readOnly ? (e) => e.currentTarget.select() : undefined}
              onChange={(e) => { setValue(e.target.value); setError(''); }}
            />
            {error && <p id="cd-err" className="mt-1.5 text-sm font-bold text-bad" role="alert">{error}</p>}
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {!readOnly && (
            <button type="button" data-cancel className="btn btn-soft min-h-[44px]" onClick={() => finish(false)}>{o.cancelLabel ?? 'Отмена'}</button>
          )}
          <button data-ok className={`btn min-h-[44px] ${o.danger ? '!bg-badsolid hover:!brightness-110' : ''}`}>
            {o.confirmLabel ?? (readOnly ? 'Готово' : o.danger ? 'Удалить' : 'Подтвердить')}
          </button>
        </div>
      </form>
    </div>
  );
}
