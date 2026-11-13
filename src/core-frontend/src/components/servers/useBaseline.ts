import { useState } from 'react';
import { api } from '../../api';
import { usePoll } from '../../ui';

/** the baseline of the week of a server (the usual players per hour, UTC), from the details of the server; null until it is known */
export function useBaseline(serverId: number): (number | null)[] | null {
  const [b, setB] = useState<(number | null)[] | null>(null);
  usePoll(() => api<{ baseline?: (number | null)[] | null }>(`/servers/${serverId}/details?hours=24`).then((d) => setB(Array.isArray(d?.baseline) ? d.baseline : null)).catch(() => undefined), 300_000);
  return b;
}
