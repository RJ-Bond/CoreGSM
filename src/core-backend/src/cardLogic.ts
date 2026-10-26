/** The server card picture: pure helpers (names, colours, state banner). */

/** the first letter or digit of a name, upper case; «?» for names made of symbols */
export function initialOf(name: string): string {
  const m = Array.from(name.trim()).find((c) => /[\p{L}\p{N}]/u.test(c));
  return m ? m.toUpperCase() : '?';
}

const AVATAR_COLORS = ['#7b6cf6', '#3ddc84', '#f6b73c', '#ff7a59', '#38bdf8', '#e879f9', '#2dd4bf', '#a3e635'];
/** a stable colour per name, so the same player always looks the same */
export function avatarColor(name: string): string {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** who to show on the card: up to `max` names, and how many more there are */
export function whoInGame(names: string[], max = 4): { shown: string[]; rest: number } {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  return { shown: clean.slice(0, max), rest: Math.max(0, clean.length - max) };
}

/** «14:20» in the given time zone (the panel's) */
export function clock(ts: number, timeZone: string): string {
  try {
    return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone });
  } catch {
    return new Date(ts).toISOString().slice(11, 16);
  }
}

export interface StateBand {
  kind: 'offline' | 'maint';
  text: string;
}

/** the diagonal banner of a card: none while the server is up; «ОФЛАЙН · с 14:20» or «ОБСЛУЖИВАНИЕ · до 16:00» */
export function stateBand(s: { known: boolean; online: boolean; since: number | null; maintenanceUntil: number | null }, timeZone: string): StateBand | null {
  if (s.maintenanceUntil) return { kind: 'maint', text: `ОБСЛУЖИВАНИЕ · до ${clock(s.maintenanceUntil, timeZone)}` };
  if (!s.known || s.online) return null;
  return { kind: 'offline', text: s.since ? `ОФЛАЙН · с ${clock(s.since, timeZone)}` : 'ОФЛАЙН' };
}
