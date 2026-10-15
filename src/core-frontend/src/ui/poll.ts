/** Polling that pauses in hidden tabs, and the shared "slow server" threshold. */
import { useEffect, useRef } from 'react';
import type { Server } from '../api';

/**
 * Calls `fn` now and then every `ms` milliseconds.
 * - nothing runs while the tab is hidden; coming back to the tab refreshes at once
 * - a tick is skipped while the previous call (if it returns a promise) is still pending
 * - nothing is scheduled after unmount
 */
export function usePoll(fn: () => unknown, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let alive = true;
    let pending = false;
    const run = async () => {
      if (!alive || pending || document.hidden) return;
      pending = true;
      try {
        await ref.current();
      } catch {
        /* the caller shows its own errors */
      } finally {
        pending = false;
      }
    };
    void run();
    const t = setInterval(() => void run(), ms);
    const onVisible = () => { if (!document.hidden) void run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ms]);
}

/** a server answers, but slowly (ping over 100 ms) */
export const LAG_PING = 100;
export const isLag = (s: Pick<Server, 'online' | 'ping'>) => s.online && s.ping != null && s.ping > LAG_PING;
