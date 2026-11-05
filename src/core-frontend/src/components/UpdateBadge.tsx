import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { api, type UpdateInfo } from '../api';
import { NO_UPDATE, shownUpdate, updateStateOf, type UpdateState } from './updateState';
import { t } from '../i18n';

export { NO_UPDATE, shownUpdate, updateStateOf, type UpdateState } from './updateState';

// one state for every badge (the bottom bar, the header, the side menu, the settings tab)
let current: UpdateState = NO_UPDATE;
const listeners = new Set<() => void>();
const same = (a: UpdateState, b: UpdateState) => a.available === b.available && a.running === b.running && a.progress === b.progress && a.version === b.version;
export function setUpdateState(next: UpdateState): void {
  if (same(current, next)) return;
  current = next;
  listeners.forEach((l) => l());
}
export const useUpdateState = (): UpdateState =>
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => current, () => NO_UPDATE);

/** Asks the panel about updates: once a minute, every three seconds while one is being installed. */
export function useUpdatePolling(enabled: boolean, onAvailable?: (v: boolean) => void): void {
  const notify = useRef(onAvailable);
  notify.current = onAvailable;
  useEffect(() => {
    if (!enabled) {
      setUpdateState(NO_UPDATE);
      return;
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let next = current.running ? 3_000 : 60_000;
      if (!document.hidden || current.running) {
        try {
          const s = updateStateOf(await api<UpdateInfo>('/update/status'));
          setUpdateState(s);
          notify.current?.(s.available);
          next = s.running ? 3_000 : 60_000;
        } catch {
          /* the panel is restarting or offline: try again */
        }
      }
      if (!stop) timer = setTimeout(() => void tick(), next);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);
}

/** The one badge for «an update is waiting» (an arrow) and «it is being installed» (a ring that fills up). */
export function UpdateBadge({ className = '' }: { className?: string }) {
  const s = useUpdateState();
  if (!shownUpdate(s)) return null;
  const label = s.running ? t('upd.badge.running', { p: s.progress }) : t('upd.badge.avail', { v: s.version || '' });
  return (
    <span
      className={`upd-badge ${s.running ? 'is-running' : 'is-avail'} ${className}`}
      style={s.running ? ({ '--p': s.progress } as CSSProperties) : undefined}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
      </svg>
    </span>
  );
}
