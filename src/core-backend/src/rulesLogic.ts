/** Versions of the community rules and consent: pure rules. */
export interface RulesVersion { version: number; text: string }

/** the number of a new version when `text` differs from the latest one; null when nothing is to be recorded */
export function nextRulesVersion(latest: RulesVersion | null, text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (latest && latest.text.trim() === t) return null;
  return (latest?.version ?? 0) + 1;
}

/** a player has to agree (again) when there are rules and the agreed version is not the current one */
export const needsAgreement = (current: number | null, agreed: number | null): boolean => current !== null && agreed !== current;
