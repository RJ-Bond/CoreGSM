// «Недавние» and «Закреплённые» of the admin sidebar: plain list helpers (no DOM) plus the localStorage glue.

export const RECENT_KEY = 'coregsm_admin_recent';
export const PINS_KEY = 'coregsm_admin_pins';
export const RECENT_MAX = 5;
export const PINS_MAX = 6;

/** a stored value -> a clean list: strings only, known ids only, no duplicates, at most `max` */
export function cleanIds(raw: unknown, valid: readonly string[], max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === 'string' && valid.includes(x) && !out.includes(x)) out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

/** the section just visited goes first; older entries follow, the list stays short */
export function pushRecent(list: string[], id: string, max = RECENT_MAX): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

/** pin or unpin; `full` is true when the pin was refused because the limit is reached */
export function togglePin(pins: string[], id: string, max = PINS_MAX): { pins: string[]; full: boolean } {
  if (pins.includes(id)) return { pins: pins.filter((x) => x !== id), full: false };
  if (pins.length >= max) return { pins, full: true };
  return { pins: [...pins, id], full: false };
}

export function readIds(key: string, valid: readonly string[], max: number): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? cleanIds(JSON.parse(raw), valid, max) : [];
  } catch {
    return [];
  }
}

export function writeIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* private mode: not remembered */
  }
}
