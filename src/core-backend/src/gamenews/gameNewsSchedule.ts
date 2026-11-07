/**
 * The schedule of an automatic in-game announcement (pure functions, no database).
 *  - interval: every N minutes (the first one N minutes after it is switched on);
 *  - daily: at fixed times of the day in the panel's time zone;
 *  - once: at one moment.
 */
import { localParts, offsetAt } from '../admin/localTime.js';

export type RuleKind = 'interval' | 'daily' | 'once';

export interface Schedule {
  kind: RuleKind;
  everyMin: number;
  times: string[];
  runAt: number | null;
}

const MIN = 60_000;
export const MIN_EVERY = 5;
export const MAX_EVERY = 10_080; // a week
/** a run that is later than this behind its time (the panel was off) is skipped, not sent late */
export const GRACE_MS = 2 * MIN;

export const isHHMM = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** valid, unique, sorted times */
export function cleanTimes(times: string[]): string[] {
  return [...new Set(times.filter(isHHMM))].sort();
}

/** the UTC moment of the wall-clock time `hh:mm` on the day y-m-d in a time zone */
function wallToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const guess = naive - offsetAt(naive, tz);
  return naive - offsetAt(guess, tz);
}

/** the first run strictly after `after`, or null when there is none (a once rule in the past) */
export function nextRunAfter(s: Schedule, after: number, tz: string): number | null {
  if (s.kind === 'interval') return after + Math.max(MIN_EVERY, s.everyMin) * MIN;
  if (s.kind === 'once') return s.runAt != null && s.runAt > after ? s.runAt : null;
  const times = cleanTimes(s.times);
  if (!times.length) return null;
  const [y, m, d] = localParts(after, tz).day.split('-').map(Number);
  let best: number | null = null;
  for (let add = 0; add <= 2; add++) {
    for (const t of times) {
      const [hh, mm] = t.split(':').map(Number);
      const ts = wallToUtc(y, m, d + add, hh, mm, tz);
      if (ts > after && (best == null || ts < best)) best = ts;
    }
  }
  return best;
}

/** whether `now` is inside the optional [from, to] range of dates */
export function inWindow(now: number, from: number | null, to: number | null): boolean {
  if (from != null && now < from) return false;
  if (to != null && now > to) return false;
  return true;
}

export type Due = 'fire' | 'skip' | 'wait';

/** what to do with a rule whose next run is `nextRun` */
export function dueState(nextRun: number | null, now: number): Due {
  if (nextRun == null || nextRun > now) return 'wait';
  return now - nextRun <= GRACE_MS ? 'fire' : 'skip';
}

/** the next `n` runs starting with `first` (the stored next run), for the «upcoming» list */
export function upcomingRuns(s: Schedule, first: number | null, n: number, tz: string): number[] {
  const out: number[] = [];
  let at = first;
  while (at != null && out.length < n) {
    out.push(at);
    at = nextRunAfter(s, at, tz);
  }
  return out;
}
