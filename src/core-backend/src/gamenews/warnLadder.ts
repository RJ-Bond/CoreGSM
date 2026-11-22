/** The ladder of warnings: «at 2 a kick, at 3 a ban for a day, at 5 a week, at 7 for ever». Without a ladder the old single limit works. */

export interface LadderStep { at: number; action: 'kick' | 'ban'; time: string }

export const MAX_STEPS = 6;

/** a stored value to clean steps: sorted by `at`, one step per count, bad rows dropped */
export function cleanLadder(raw: unknown): LadderStep[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: LadderStep[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    const at = Number(x.at);
    if (!Number.isInteger(at) || at < 1 || at > 50 || seen.has(at)) continue;
    const action = x.action === 'ban' ? 'ban' : 'kick';
    const time = typeof x.time === 'string' && x.time.trim() ? x.time.trim().slice(0, 12) : '1d';
    seen.add(at);
    out.push({ at, action, time });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, MAX_STEPS);
}

export interface LadderSettings { warnLimit: number; warnAction: 'kick' | 'ban'; warnBanTime: string; ladder: LadderStep[] }

/**
 * What the n-th warning does. With a ladder a step fires exactly when the count reaches its number (so every rung fires once),
 * and `limit` is the next rung, shown in «{n} of {limit}». Without a ladder: the old limit.
 */
export function pickStep(s: LadderSettings, n: number): { step: { action: 'kick' | 'ban'; time: string } | null; limit: number; ladder: boolean } {
  if (s.ladder.length) {
    const hit = s.ladder.find((x) => x.at === n) ?? null;
    const next = s.ladder.find((x) => x.at >= n) ?? s.ladder[s.ladder.length - 1];
    return { step: hit && { action: hit.action, time: hit.time }, limit: next.at, ladder: true };
  }
  const hit = s.warnLimit > 0 && n >= s.warnLimit;
  return { step: hit ? { action: s.warnAction, time: s.warnBanTime } : null, limit: s.warnLimit, ladder: false };
}
