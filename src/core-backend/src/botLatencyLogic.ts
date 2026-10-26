/** Bot gateway latency: how the samples are kept and judged. Pure, so the tests can import it without opening the database. */
export interface PingSample { ts: number; ms: number }

/** at most one sample per this many ms, and this many samples (a bit over 5 hours) */
export const PING_GAP_MS = 60_000;
export const PING_KEEP = 320;
/** above this the bot answers commands slowly (Discord shows «приложение не отвечает» after 3 s) */
export const PING_SLOW_MS = 800;
export const PING_BAD_MS = 2_000;

/** adds a sample unless the last one is too fresh; returns the same array */
export function addPing(list: PingSample[], ms: number, now: number): PingSample[] {
  if (!Number.isFinite(ms) || ms < 0) return list;
  const last = list[list.length - 1];
  if (last && now - last.ts < PING_GAP_MS) return list;
  list.push({ ts: now, ms: Math.round(ms) });
  if (list.length > PING_KEEP) list.splice(0, list.length - PING_KEEP);
  return list;
}

/** the verdict by the last samples: «bad» and «slow» need three in a row, so one spike does not raise the alarm */
export function pingVerdict(list: PingSample[]): 'ok' | 'slow' | 'bad' | 'unknown' {
  if (!list.length) return 'unknown';
  const tail = list.slice(-3);
  if (tail.length === 3 && tail.every((s) => s.ms >= PING_BAD_MS)) return 'bad';
  if (tail.length === 3 && tail.every((s) => s.ms >= PING_SLOW_MS)) return 'slow';
  return 'ok';
}

/** at most `n` points, evenly picked (the chart does not need more) */
export function thin(list: PingSample[], n: number): PingSample[] {
  if (list.length <= n) return list.slice();
  const out: PingSample[] = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return out;
}
