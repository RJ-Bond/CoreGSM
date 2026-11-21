/**
 * The scheme of a list in the admin area: a toolbar (search, the states with their counts) on top, then the items in groups by state,
 * every group with its title, its count and a fold. A group that is folded stays folded the next time (kept in this browser).
 */
import { useId, useState, type ReactNode } from 'react';
import { t, useI18n } from '../i18n';
import { IconChevronDown, IconSearch } from '../icons';

export interface ListGroup<T> {
  id: string;
  title: string;
  hint?: string;
  tone?: 'ok' | 'warn' | 'bad' | 'mute';
  items: T[];
  /** folded until somebody opens it (finished things) */
  folded?: boolean;
}

const TONE: Record<NonNullable<ListGroup<unknown>['tone']>, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', mute: 'bg-mute' };

const readFolds = (key: string): Record<string, boolean> => {
  try { return JSON.parse(localStorage.getItem(`coregsm_grp_${key}`) ?? '{}') as Record<string, boolean>; } catch { return {}; }
};

/** the items cut into groups; an empty group is not shown */
export function GroupedList<T>({ groups, itemKey, render, storageKey, className = '' }: {
  groups: ListGroup<T>[]; itemKey: (item: T) => string | number; render: (item: T) => ReactNode; storageKey: string; className?: string;
}) {
  useI18n();
  // what the person folded or opened by hand; a group that was not touched keeps its own default
  const [folds, setFolds] = useState<Record<string, boolean>>(() => readFolds(storageKey));
  const toggle = (id: string, now: boolean) => {
    const next = { ...folds, [id]: !now };
    setFolds(next);
    try { localStorage.setItem(`coregsm_grp_${storageKey}`, JSON.stringify(next)); } catch { /* not remembered */ }
  };
  const base = useId();
  return (
    <div className={`space-y-4 ${className}`}>
      {groups.filter((g) => g.items.length > 0).map((g) => {
        const folded = folds[g.id] ?? !!g.folded;
        const bodyId = `${base}-${g.id}`;
        return (
          <section key={g.id} aria-label={g.title}>
            <button type="button" className="adm-grp-head" aria-expanded={!folded} aria-controls={bodyId} onClick={() => toggle(g.id, folded)}>
              <IconChevronDown size={16} className={`adm-grp-chev ${folded ? 'is-folded' : ''}`} />
              {g.tone && <i aria-hidden className={`h-2 w-2 rounded-full ${TONE[g.tone]}`} />}
              <span className="font-extrabold">{g.title}</span>
              <span className="adm-grp-count" aria-label={t('lists.count', { n: g.items.length })}>{g.items.length}</span>
              {g.hint && <span className="hidden min-w-0 truncate text-sm font-semibold text-mute sm:inline">{g.hint}</span>}
            </button>
            {!folded && (
              <ul id={bodyId} className="panel mt-1.5 divide-y divide-line overflow-hidden">
                {g.items.map((it) => <li key={itemKey(it)}>{render(it)}</li>)}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** the bar over a list: a search and the states with how many there are in each (sticky under the header on a long page) */
export function ListToolbar<S extends string>({ search, onSearch, placeholder, states, value, onChange, right, label }: {
  search?: string; onSearch?: (v: string) => void; placeholder?: string;
  states?: { id: S; label: string; count?: number }[]; value?: S; onChange?: (id: S) => void; right?: ReactNode; label: string;
}) {
  return (
    <div className="adm-listbar" role="search" aria-label={label}>
      {onSearch && (
        <label className="adm-listbar-search">
          <IconSearch size={16} />
          <input type="search" className="min-w-0 flex-1 bg-transparent outline-none" value={search ?? ''} placeholder={placeholder} aria-label={placeholder ?? label} onChange={(e) => onSearch(e.target.value)} />
        </label>
      )}
      {states && value && onChange && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
          {states.map((s) => (
            <button key={s.id} type="button" className={`chip-filter ${value === s.id ? 'on' : ''}`} aria-pressed={value === s.id} onClick={() => onChange(s.id)}>
              {s.label}{s.count != null && <span className="ml-1.5 text-xs font-extrabold opacity-70">{s.count}</span>}
            </button>
          ))}
        </div>
      )}
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}
