// A common «Есть несохранённые изменения: Отмена / Сохранить» bar for pages with several forms (settings, users).
// A form joins it with useSaveBar(); without a provider around it a form keeps saving by itself (useAutosave).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SaveStatus } from './autosave';
import { needsBar, summarize } from './saveBarLogic';
import { Spinner } from './ui';
import { t, useI18n } from './i18n';

interface Entry { label: string; status: SaveStatus; save: () => Promise<unknown>; discard: () => void }
interface Ctx { set: (id: string, e: Entry | null) => void }
const BarCtx = createContext<Ctx | null>(null);

/** true inside a provider: the forms switch their autosave to «manual» and use the bar */
export const useSaveBarActive = (): boolean => useContext(BarCtx) !== null;

/** Registers a form in the bar; call it every render with the current status and the two actions. */
export function useSaveBar(id: string, label: string, status: SaveStatus, save: () => Promise<unknown>, discard: () => void): void {
  const ctx = useContext(BarCtx);
  const act = useRef({ save, discard });
  act.current = { save, discard };
  useEffect(() => {
    ctx?.set(id, { label, status, save: () => act.current.save(), discard: () => act.current.discard() });
  }, [ctx, id, label, status]);
  useEffect(() => () => ctx?.set(id, null), [ctx, id]);
}

export function SaveBarProvider({ children }: { children: ReactNode }) {
  useI18n();
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const set = useCallback((id: string, e: Entry | null) => {
    setEntries((cur) => {
      if (!e) {
        if (!(id in cur)) return cur;
        const { [id]: _gone, ...rest } = cur;
        return rest;
      }
      return { ...cur, [id]: e };
    });
  }, []);
  // a stable value: the forms re-register only when their own status changes (a new object every render would loop)
  const api = useMemo(() => ({ set }), [set]);
  const state = summarize(Object.fromEntries(Object.entries(entries).map(([id, e]) => [id, { label: e.label, status: e.status }])));

  // leaving the page or closing the tab with unsaved edits: the browser asks
  useEffect(() => {
    if (!state.show) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.show]);

  const save = () => void Promise.allSettled(state.saveIds.map((id) => entries[id]?.save()));
  const discard = () => Object.values(entries).forEach((e) => { if (needsBar(e.status)) e.discard(); });

  return (
    <BarCtx.Provider value={api}>
      <div className="space-y-5">
        {children}
        {state.show && (
          <div className="save-bar" role="region" aria-label={t('d2.sb.unsaved')}>
            <i aria-hidden className={`save-bar-dot ${state.failed ? 'is-bad' : ''}`} />
            <b className="min-w-0 flex-1 truncate" title={state.text}>{state.text}</b>
            {state.blocked && <span className="hidden text-sm font-semibold text-bad sm:inline">{t('d2.sb.fix')}</span>}
            <button type="button" className="btn btn-ghost btn-sm" disabled={state.saving} onClick={discard}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-sm" disabled={state.saving || state.blocked || state.saveIds.length === 0} onClick={save}>
              {state.saving ? <><Spinner className="h-3.5 w-3.5" />{t('d2.adm.saving')}</> : t('common.save')}
            </button>
          </div>
        )}
      </div>
    </BarCtx.Provider>
  );
}
