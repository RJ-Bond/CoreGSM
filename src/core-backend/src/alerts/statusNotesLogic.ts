// Notes on the public status page («Идут работы», «Причина сбоя найдена»): pure rules, covered by tests.
export const NOTE_LEVELS = ['info', 'warn', 'bad', 'ok'] as const;
export type NoteLevel = (typeof NOTE_LEVELS)[number];

export interface NoteRow { id: number; title: string; body: string; level: NoteLevel; server_id: number | null; created_at: number; updated_at: number; resolved_at: number | null }

/** how long a closed note stays on the page, and how many notes the page shows at most */
export const RESOLVED_KEEP_MS = 14 * 86_400_000;
export const NOTES_SHOWN = 20;

/**
 * The notes the public page shows: the open ones first (the most serious, then the newest), then the notes closed within
 * the last two weeks (the newest first). Older closed notes stay only in the administrators' list.
 */
export function visibleNotes<T extends Pick<NoteRow, 'level' | 'created_at' | 'resolved_at'>>(rows: T[], now: number): T[] {
  const open = rows
    .filter((r) => r.resolved_at == null)
    .sort((a, b) => {
      // «bad» and «warn» before «info» and «ok»
      const rank = (l: NoteLevel) => (l === 'bad' ? 0 : l === 'warn' ? 1 : l === 'info' ? 2 : 3);
      return rank(a.level) - rank(b.level) || b.created_at - a.created_at;
    });
  const closed = rows
    .filter((r) => r.resolved_at != null && now - (r.resolved_at as number) <= RESOLVED_KEEP_MS)
    .sort((a, b) => (b.resolved_at as number) - (a.resolved_at as number));
  return [...open, ...closed].slice(0, NOTES_SHOWN);
}

/** the colour of a note on the page: a resolved one is always calm */
export const noteTone = (level: NoteLevel, resolved: boolean): NoteLevel => (resolved ? 'ok' : level);
