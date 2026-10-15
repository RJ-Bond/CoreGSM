/** The grid of the admin pages: page root, sections, strips, autosave badge and text fields. */
import { type ReactNode, useId } from 'react';
import type { SaveStatus } from '../autosave';
import { IconCheck } from '../icons';
import { FieldError, Spinner } from './authParts';

// ---------- admin page grid: one rhythm for every page of the admin area ----------

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
        {retry && <button type="button" className="btn-link btn-link-tone" onClick={retry}>Повторить</button>}
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
