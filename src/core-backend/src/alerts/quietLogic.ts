/** Quiet hours of the push notifications: a daily window in the user's own time (it may cross midnight). Pure. */
export interface Quiet { enabled: boolean; fromMin: number; toMin: number; tz: number }

export const DEFAULT_QUIET: Quiet = { enabled: false, fromMin: 23 * 60, toMin: 8 * 60, tz: 0 };

/** minutes since local midnight for a UTC instant and the user's offset east of UTC, in minutes */
export const localMinutes = (utcMs: number, tz: number): number => (((Math.floor(utcMs / 60_000) + tz) % 1440) + 1440) % 1440;

export function inQuiet(q: Quiet, utcMs: number): boolean {
  if (!q.enabled || q.fromMin === q.toMin) return false;
  const m = localMinutes(utcMs, q.tz);
  return q.fromMin < q.toMin ? m >= q.fromMin && m < q.toMin : m >= q.fromMin || m < q.toMin;
}

export const hhmm = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export function parseHhmm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
