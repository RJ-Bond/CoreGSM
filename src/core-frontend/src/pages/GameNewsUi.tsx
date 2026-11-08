import { useState, type ReactNode } from 'react';
import { t, useI18n } from '../i18n';
import { SCOPE_KEYS, useScope } from './GameNewsScope';

/** a quiet block for a list that has nothing in it yet: what it is for and the way to fill it */
export function EmptyState({ icon = '○', title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-5 py-8 text-center">
      <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-full bg-soft text-xl text-mute">{icon}</span>
      <p className="font-extrabold">{title}</p>
      {hint && <p className="max-w-md text-sm font-semibold text-mute">{hint}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

/** on / off in one look everywhere: a dot and a word */
export function StateBadge({ on, onText, offText }: { on: boolean; onText?: string; offText?: string }) {
  useI18n();
  return (
    <span className={on ? 'pill pill-ok' : 'pill pill-mute'}>
      <span aria-hidden className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${on ? 'bg-ok' : 'bg-mute'}`} />
      {on ? (onText ?? t('gn.f.on')) : (offText ?? t('gn.f.off'))}
    </span>
  );
}

/** tabs inside a page: a row of chips that scrolls sideways on a phone instead of wrapping into a pile */
export function SubTabs<T extends string>({ items, value, onChange, label }: { items: { id: T; label: string; badge?: number }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label={label}>
      <div className="flex min-w-max gap-2 md:min-w-0 md:flex-wrap">
        {items.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={value === x.id} className={`chip-filter whitespace-nowrap ${value === x.id ? 'on' : ''}`} onClick={() => onChange(x.id)}>
            {x.label}
            {(x.badge ?? 0) > 0 && <span className="ml-1.5 rounded-full bg-soft px-1.5 text-xs font-extrabold">{x.badge}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** fields on the left, the preview of the game chat on the right (under the fields on a narrow screen) and kept in view while the fields are edited */
export function WithPreview({ children, preview }: { children: ReactNode; preview: ReactNode }) {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-w-0 space-y-4">{children}</div>
      <div className="min-w-0 space-y-2 xl:sticky xl:top-4">{preview}</div>
    </div>
  );
}

/**
 * A settings card of a server's page. A server that uses the general value shows one slim line («uses the general settings»
 * with a button to set it up apart): so a page of a server does not repeat every card of the general page.
 */
export function ScopedCard({ part, title, children }: { part: keyof typeof SCOPE_KEYS; title: string; children: ReactNode }) {
  useI18n();
  const s = useScope();
  const [open, setOpen] = useState(false);
  if (!s.server || !s.mine) return <>{children}</>;
  if (s.mine[SCOPE_KEYS[part]] || open) return <>{children}</>;
  return (
    <section className="panel flex flex-wrap items-center gap-3 px-5 py-3.5">
      <span className="min-w-0 flex-1 basis-56">
        <span className="block font-extrabold">{title}</span>
        <span className="block text-sm font-semibold text-mute">{t('gn.sc.inheritShort')}</span>
      </span>
      <span className="pill pill-mute">{t('gn.sc.general')}</span>
      <button type="button" className="btn btn-soft btn-sm" onClick={() => setOpen(true)}>{t('gn.sc.setup')}</button>
    </section>
  );
}
