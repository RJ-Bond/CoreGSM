/** Blocking an account for a while (or for good) with a reason: the pure part. */

export interface BanRow {
  banned_at: number | null;
  banned_until: number | null;
  ban_reason: string | null;
}

export interface BanState {
  /** until when (ms); null = permanent */
  until: number | null;
  reason: string;
  at: number;
}

/** the active ban of an account, or null (a ban that has run out is no ban — nothing has to clean it up) */
export function activeBan(r: BanRow, now: number): BanState | null {
  if (!r.banned_at) return null;
  if (r.banned_until && r.banned_until <= now) return null;
  return { until: r.banned_until || null, reason: r.ban_reason ?? '', at: r.banned_at };
}

/** hours → the end of the ban; null/0 = permanent; the longest finite ban is a year */
export function banUntil(hours: number | null | undefined, now: number): number | null {
  if (!hours) return null;
  return now + Math.min(Math.max(Math.round(hours), 1), 8760) * 3_600_000;
}
