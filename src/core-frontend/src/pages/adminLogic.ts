/** The pure parts of the admin overview: the health of the panel as one number with the reasons for it */

export interface HealthInput {
  servers: number;
  down: number;
  botError: boolean;
  certDays: number | null;
  pending: number;
  updateAvailable: boolean;
  backupAgeMs: number | null; // null — no copies at all
  backupsKnown: boolean;
}

export interface HealthReason { id: string; cost: number; tone: 'bad' | 'warn' | 'info' }

const WEEK = 7 * 86_400_000;

/** 100 minus the cost of everything that is wrong; every cost is listed so the ring can explain itself */
export function healthScore(h: HealthInput): { score: number; reasons: HealthReason[] } {
  const reasons: HealthReason[] = [];
  if (h.down > 0 && h.servers > 0) reasons.push({ id: 'down', cost: Math.min(50, Math.round((h.down / h.servers) * 60) + 10), tone: 'bad' });
  if (h.botError) reasons.push({ id: 'bot', cost: 20, tone: 'bad' });
  if (h.certDays != null && h.certDays <= 14) reasons.push({ id: 'cert', cost: h.certDays <= 0 ? 25 : 10, tone: h.certDays <= 0 ? 'bad' : 'warn' });
  if (h.backupsKnown && (h.backupAgeMs == null || h.backupAgeMs > WEEK)) reasons.push({ id: 'backup', cost: 10, tone: 'warn' });
  if (h.pending > 0) reasons.push({ id: 'pending', cost: Math.min(10, 3 + h.pending), tone: 'warn' });
  if (h.updateAvailable) reasons.push({ id: 'update', cost: 3, tone: 'info' });
  const score = Math.max(0, 100 - reasons.reduce((n, r) => n + r.cost, 0));
  return { score, reasons };
}

/** A change between two numbers for a tile: +3 / −2, nothing when equal or unknown */
export function delta(now: number, before: number | null | undefined): { text: string; tone: 'up' | 'down' } | null {
  if (before == null || now === before) return null;
  const d = now - before;
  return { text: `${d > 0 ? '+' : '−'}${Math.abs(d)}`, tone: d > 0 ? 'up' : 'down' };
}

/** The set of local daily checks is keyed by the date so the list starts anew each day */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** «g» then a letter jumps to a section of the admin area */
export const CHORDS: Record<string, string> = { o: 'overview', s: 'servers', d: 'discord', n: 'news', a: 'alerts', u: 'users', j: 'journal', y: 'system', h: 'health', c: 'community', t: 'settings' };

/** the letter of a section's chord, if it has one */
export const chordOf = (section: string): string | null => Object.entries(CHORDS).find(([, id]) => id === section)?.[0] ?? null;
