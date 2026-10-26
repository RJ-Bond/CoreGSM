/**
 * The rule «the server is down»: at least N of the last M checks did not get an answer.
 * Pure (no database, no network); unit-tested directly.
 *
 * Without own N and M the old behaviour stays: the setting poll_fail_threshold (consecutive failed polls) decides,
 * which is the same as N = M = threshold. `custom` tells the caller whether the rule was set by the administrator.
 * Optionally the checks from other places (probes) can veto the verdict: when more of the fresh probes see the server
 * than do not, the trouble is on the way between the panel and the server, not in the server.
 */

/** the longest window of checks that is kept in view */
export const MAX_WINDOW = 20;

export interface DownRule {
  /** failed checks needed */
  n: number;
  /** size of the window of last checks */
  m: number;
  /** the probes may overrule the panel */
  probeVeto: boolean;
  /** n or m was set by the administrator (otherwise the consecutive-failure threshold is used as it always was) */
  custom: boolean;
}

const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * Turns the stored settings into a rule. `threshold` is the consecutive-failure threshold (1..5).
 * Unset n and m follow the threshold; n larger than m is cut down to m; both are limited to 1..MAX_WINDOW.
 */
export function resolveRule(raw: { n?: unknown; m?: unknown; probeVeto?: unknown }, threshold: number): DownRule {
  const t = Math.min(MAX_WINDOW, Math.max(1, toInt(threshold) ?? 2));
  const rn = toInt(raw.n);
  const rm = toInt(raw.m);
  const clamp = (v: number) => Math.min(MAX_WINDOW, Math.max(1, v));
  let m = rm === null ? (rn === null ? t : Math.max(t, clamp(rn))) : clamp(rm);
  let n = rn === null ? Math.min(t, m) : clamp(rn);
  if (n > m) n = m;
  if (m < 1) m = 1;
  return { n, m, probeVeto: raw.probeVeto === true || raw.probeVeto === '1' || raw.probeVeto === 1, custom: rn !== null || rm !== null };
}

export interface Verdict {
  down: boolean;
  /** failed checks inside the window */
  failed: number;
  /** checks inside the window (less than m while the history is short) */
  seen: number;
  /** the panel's rule was met, but the probes see the server */
  vetoed: boolean;
}

/**
 * `recent`: the answers of the panel's own checks, oldest first, the newest one last (true = the server answered).
 * `probes`: the latest fresh answer of every probe (true = sees the server); empty or missing = no opinion.
 */
export function judgeDown(i: { recent: boolean[]; rule: Pick<DownRule, 'n' | 'm' | 'probeVeto'>; probes?: boolean[] }): Verdict {
  const m = Math.max(1, Math.floor(i.rule.m));
  const n = Math.min(m, Math.max(1, Math.floor(i.rule.n)));
  const win = i.recent.slice(-m);
  const failed = win.filter((ok) => !ok).length;
  const panelDown = failed >= n;
  if (!panelDown) return { down: false, failed, seen: win.length, vetoed: false };
  const probes = i.probes ?? [];
  if (i.rule.probeVeto && probes.length) {
    const up = probes.filter(Boolean).length;
    // a tie is not a veto: an outage must not be hidden because the opinions are split
    if (up > probes.length - up) return { down: false, failed, seen: win.length, vetoed: true };
  }
  return { down: true, failed, seen: win.length, vetoed: false };
}
