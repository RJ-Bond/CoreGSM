/** Small pure parts of the profile card picture. */

/** a stable colour angle from a name: the same name is always the same colour */
export function hueOf(name: string): number {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** the first letter, upper case; «?» for an empty name */
export const initialOf = (name: string): string => (Array.from(name.trim())[0] ?? '?').toUpperCase();

/** «94,2 ч» / «12 ч» / «45 мин» / «0 ч» */
export function hoursText(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0 ч';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} мин`;
  const v = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours);
  return `${String(v).replace('.', ',')} ч`;
}
