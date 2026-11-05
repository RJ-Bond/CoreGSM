import type { UpdateInfo } from '../api';

/** What the badges of the panel show: an update waits, or one is being installed right now (with its percent). */
export interface UpdateState {
  available: boolean;
  running: boolean;
  /** 0..100 while an update is running */
  progress: number;
  version: string;
}
export const NO_UPDATE: UpdateState = { available: false, running: false, progress: 0, version: '' };

export const shownUpdate = (s: UpdateState): boolean => s.available || s.running;

/** the state from the answer of /update/status (skipped versions do not nag) */
export function updateStateOf(r: UpdateInfo): UpdateState {
  const running = r.job?.state === 'running';
  const p = r.job?.progress;
  return {
    available: r.available && !r.skipped,
    running,
    progress: running && typeof p === 'number' ? Math.max(0, Math.min(100, Math.round(p))) : 0,
    version: r.latestLabel || r.latest || '',
  };
}
