/**
 * Data loading with a shared cache (TanStack Query). The same rules as usePoll: nothing is requested in a hidden tab
 * or without a network, coming back refreshes at once, and the data-saving mode (html[data-lite]) waits twice as long.
 * New code uses useApiQuery; usePoll stays where a page has not moved over yet.
 */
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // the page shows its own errors; a failed refresh keeps the last data on screen
      throwOnError: false,
    },
  },
});

/** the pause between refreshes: doubled in the data-saving mode, none when `ms` is 0 */
export const pollEvery = (ms: number, lite: boolean): number | false => (ms > 0 ? (lite ? ms * 2 : ms) : false);

const isLite = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-lite');

/** GET `path` of the panel API; `pollMs` refreshes it now and then (0 = only when asked) */
export function useApiQuery<T>(path: string, { pollMs = 0, enabled = true }: { pollMs?: number; enabled?: boolean } = {}) {
  return useQuery<T>({
    queryKey: ['api', path],
    queryFn: () => api<T>(path),
    enabled,
    refetchInterval: () => pollEvery(pollMs, isLite()),
    refetchIntervalInBackground: false,
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
