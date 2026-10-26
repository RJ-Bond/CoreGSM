// Which achievements play the «just earned» animation: earned in the last day and not yet seen in this browser.
const KEY = 'coregsm_ach_seen';
const FRESH_MS = 24 * 3600_000;

export function loadSeen(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-200) : [];
  } catch { return []; }
}

export function markSeen(id: string): void {
  try {
    const seen = loadSeen();
    if (!seen.includes(id)) localStorage.setItem(KEY, JSON.stringify([...seen, id].slice(-200)));
  } catch { /* not remembered */ }
}

/** earned within the last day and not marked as seen */
export function isFresh(a: { id: string; earned: boolean; earnedAt: number | null }, seen: string[], now = Date.now()): boolean {
  return a.earned && a.earnedAt != null && now - a.earnedAt < FRESH_MS && now - a.earnedAt >= 0 && !seen.includes(a.id);
}
