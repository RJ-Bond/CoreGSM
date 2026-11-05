/** Settings of the moderation commands (/clear): the checks of what the panel sends. */
export const MAX_PROTECTED = 50;
export const MAX_COOLDOWN = 1440;
export const DEFAULT_COOLDOWN = 2;

const ID = /^\d{15,25}$/;

/** well-formed Discord ids without duplicates, at most `max` */
export function cleanIds(v: unknown, max = MAX_PROTECTED): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && ID.test(x)))].slice(0, max) : [];
}

/** minutes between two cleanings of one channel: a whole number 0..1440, anything else is the default */
export function cleanCooldown(v: unknown): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_COOLDOWN ? n : DEFAULT_COOLDOWN;
}

/** the stored JSON list of ids; broken data gives an empty list */
export function parseIds(raw: string | null | undefined): string[] {
  try {
    return cleanIds(JSON.parse(raw ?? '[]') as unknown);
  } catch {
    return [];
  }
}
