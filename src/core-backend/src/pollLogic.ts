/** Pure helpers of the poller (no database, no network): unit-tested directly. */

export const DEFAULT_FAIL_THRESHOLD = 2;
export const DEFAULT_CONCURRENCY = 8;

const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : null;
};

/** consecutive failed polls needed before a server is shown as offline: 1..5, default 2 */
export function clampThreshold(v: unknown): number {
  const n = toInt(v);
  return n === null ? DEFAULT_FAIL_THRESHOLD : Math.min(5, Math.max(1, n));
}

/** number of servers polled at the same time: 1..32, default 8 */
export function clampConcurrency(v: unknown): number {
  const n = toInt(v);
  return n === null ? DEFAULT_CONCURRENCY : Math.min(32, Math.max(1, n));
}

export interface Decision {
  /** the state to store in `status` */
  online: boolean;
  /** false: the failed poll is not believed yet, the last good state is kept */
  confirmed: boolean;
  /** consecutive failed polls including this one (0 after a successful poll) */
  failures: number;
  /** this very poll turned an online server offline */
  becameOffline: boolean;
}

/**
 * Whether a poll result changes what the panel shows.
 *  - a successful poll always counts and resets the counter;
 *  - a failed poll counts at once when there is no state to hold (new server) or the server is already offline;
 *  - otherwise the last good state is kept until `threshold` consecutive polls have failed.
 */
export function decideStatus(i: { prevOnline: boolean | null; prevFailures: number; polledOnline: boolean; threshold: number }): Decision {
  if (i.polledOnline) return { online: true, confirmed: true, failures: 0, becameOffline: false };
  const failures = Math.min(1_000_000, Math.max(0, Math.floor(i.prevFailures)) + 1);
  const threshold = clampThreshold(i.threshold);
  if (i.prevOnline === null || i.prevOnline === false) return { online: false, confirmed: true, failures, becameOffline: false };
  if (failures >= threshold) return { online: false, confirmed: true, failures, becameOffline: true };
  return { online: true, confirmed: false, failures, becameOffline: false };
}

/** runs `worker` over `items`, at most `limit` at a time; a failing worker never stops the others */
export async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  const n = Math.max(1, Math.floor(limit));
  let next = 0;
  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        await worker(items[i], i);
      } catch {
        /* the worker reports its own failures */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane));
}
