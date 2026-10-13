import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

/**
 * GET `path` for a profile panel. `data`: undefined while the first answer is awaited, null when the endpoint is
 * unavailable (404, offline, malformed answer): the panel then hides itself instead of breaking the page.
 * `path` null = do not load. `check` rejects answers of the wrong shape.
 */
export function useFetched<T>(path: string | null, check?: (v: unknown) => boolean) {
  const [data, setData] = useState<T | null | undefined>(undefined);
  const [loading, setLoading] = useState(path !== null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (path === null) return;
    let stale = false;
    setLoading(true);
    api<T>(path)
      .then((v) => { if (!stale) setData(check && !check(v) ? null : v); })
      .catch(() => { if (!stale) setData(null); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [path, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, loading, reload };
}

export const isArray = (v: unknown) => Array.isArray(v);
export const isObject = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
