import { useMemo } from 'react';
import { useCommunity } from '../servers/CommunityBento';

/** nicks of the community ratings: lower-case nick -> place in the week's top (0: in a rating, but not in the week's top) */
export function useKnownNicks(): Map<string, number> {
  const community = useCommunity();
  return useMemo(() => {
    const m = new Map<string, number>();
    if (!community) return m;
    community.top.week.forEach((p, i) => m.set(p.name.toLowerCase(), i + 1));
    for (const k of ['month', 'all', 'day'] as const) community.top[k].forEach((p) => { if (!m.has(p.name.toLowerCase())) m.set(p.name.toLowerCase(), 0); });
    return m;
  }, [community]);
}
