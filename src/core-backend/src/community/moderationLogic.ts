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

/** the reasons offered while a moderator types /ban, /kick or /warn (the panel can change the list) */
export const DEFAULT_REASONS = ['Спам', 'Оскорбления', 'Читы / нечестная игра', 'Реклама', 'Нарушение правил сервера'];
export const MAX_REASONS = 15;
export const MAX_REASON_LEN = 100;

/** the list of reasons: trimmed, no empty ones or duplicates, each up to 100 characters (a limit of Discord hints), at most 15 */
export function cleanReasons(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_LEN) : '';
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, MAX_REASONS);
}

/** the stored reasons; before anything is saved the defaults are offered */
export function parseReasons(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return DEFAULT_REASONS;
  try {
    return cleanReasons(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_REASONS;
  }
}

/** a whole number in [min, max], anything else is `def` */
export function cleanInt(v: unknown, min: number, max: number, def: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : def;
}

export const DEFAULT_WARN_TTL_DAYS = 30;
export const MAX_WARN_TTL_DAYS = 3650;
/** a timeout of Discord lasts 28 days at most */
export const MAX_MUTE_MINUTES = 40_320;
export const DEFAULT_MUTE_MINUTES = 60;
export const MAX_LADDER = 50;
/** how many warnings fill the scale when no kick threshold is set */
export const DEFAULT_SCALE = 5;

export interface Ladder {
  /** warnings that bring a timeout (0 = off) */
  muteAt: number;
  muteMinutes: number;
  /** warnings that bring a kick (0 = off) */
  kickAt: number;
}

export type LadderStep = { action: 'timeout'; minutes: number } | { action: 'kick' } | null;

/** what the warning that makes `total` active warnings brings: a kick beats a timeout */
export function ladderFor(total: number, l: Ladder): LadderStep {
  if (l.kickAt > 0 && total >= l.kickAt) return { action: 'kick' };
  if (l.muteAt > 0 && total >= l.muteAt) return { action: 'timeout', minutes: l.muteMinutes };
  return null;
}

/** the number the scale of warnings counts to */
export const scaleOf = (l: Ladder): number => (l.kickAt > 0 ? l.kickAt : l.muteAt > 0 ? Math.max(l.muteAt, DEFAULT_SCALE) : DEFAULT_SCALE);

/** a warning expires `days` after it was given; 0 days = never */
export const expiresAt = (now: number, days: number): number | null => (days > 0 ? now + days * 86_400_000 : null);
