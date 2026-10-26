/** Pure parts of Settings → Updates (covered by tests). */
import type { ChangelogItem, UpdateInfo, UpdateNotesRelease, UpdatePreflight, UpdateStage } from '../../api';

/** the readable version when there is one, else the short build hash */
export const versionText = (label: string | null | undefined, build: string | null | undefined): string => label || (build ? build.slice(0, 7) : '–');

/** «1.0.0.9» < «1.0.0.10»; null when either is not a readable version */
export function cmpVersion(a: string | null | undefined, b: string | null | undefined): number | null {
  const parse = (v: string | null | undefined) => (v && /^\d+(\.\d+){1,4}$/.test(v) ? v.split('.').map(Number) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export const STEPS: Exclude<UpdateStage, 'rollback'>[] = ['download', 'snapshot', 'install', 'health'];
export type StepState = 'done' | 'active' | 'todo';

/** the four steps of an update with their state; a rollback has no steps, a finished job has them all done */
export function stepStates(stage: UpdateStage | null | undefined, finished: boolean): { id: (typeof STEPS)[number]; state: StepState }[] {
  const at = stage && stage !== 'rollback' ? STEPS.indexOf(stage) : -1;
  return STEPS.map((id, i) => ({ id, state: finished || i < at ? 'done' : i === at ? 'active' : 'todo' }));
}

export type PreflightWarning = { kind: 'players'; n: number } | { kind: 'noBackup' } | { kind: 'oldBackup'; hours: number };

/** what is worth saying before the button is pressed: players online and the age of the last backup */
export function preflightWarnings(pf: UpdatePreflight | null, now: number): PreflightWarning[] {
  if (!pf) return [];
  const out: PreflightWarning[] = [];
  if (pf.players > 0) out.push({ kind: 'players', n: pf.players });
  if (pf.lastBackupAt === null) out.push({ kind: 'noBackup' });
  else if (now - pf.lastBackupAt > 36 * 3_600_000) out.push({ kind: 'oldBackup', hours: Math.floor((now - pf.lastBackupAt) / 3_600_000) });
  return out;
}

const when = (d: number | string | null): number | null => (typeof d === 'number' ? d : d ? Date.parse(String(d)) || null : null);

export type CommitGroupId = 'feat' | 'fix' | 'other';

/** the fallback when the repository has no CHANGELOG.md: commits without merges, grouped; «new» = after the installation */
export function groupCommits(items: ChangelogItem[], installedAt: number | null): { id: CommitGroupId; items: (ChangelogItem & { isNew: boolean })[] }[] {
  const groups: Record<CommitGroupId, (ChangelogItem & { isNew: boolean })[]> = { feat: [], fix: [], other: [] };
  for (const c of items) {
    if (c.kind === 'merge') continue;
    const d = when(c.date);
    groups[c.kind === 'feat' || c.kind === 'fix' ? c.kind : 'other'].push({ ...c, isNew: installedAt !== null && d !== null && d > installedAt });
  }
  return (['feat', 'fix', 'other'] as const).filter((id) => groups[id].length > 0).map((id) => ({ id, items: groups[id] }));
}

/** releases newer than the running version, when both are readable versions; the unreleased section is not new */
export function isNewerRelease(rel: UpdateNotesRelease, current: string | null | undefined): boolean {
  if (!rel.version) return false;
  const c = cmpVersion(rel.version, current);
  return c !== null && c > 0;
}

/** what changed after `seen` up to and including `current` (newest first); nothing when either is not a readable version */
export function releasesSince(releases: UpdateNotesRelease[], seen: string | null | undefined, current: string | null | undefined): UpdateNotesRelease[] {
  return releases.filter((r) => {
    if (!r.version) return false;
    const up = cmpVersion(r.version, current);
    const after = cmpVersion(r.version, seen);
    return up !== null && up <= 0 && after !== null && after > 0;
  });
}

/** the text of a note without its markers */
export const cleanNote = (s: string): string => s.replace(/\s*\[(migration|db|env)\]/gi, '').replace(/^⚠️?\s*/, '');

/** flags to warn about in the releases newer than the running one */
export function upcomingFlags(releases: UpdateNotesRelease[], current: string | null | undefined, lang: 'ru' | 'en' = 'ru'): { flag: 'breaking' | 'migration' | 'env'; text: string }[] {
  const out: { flag: 'breaking' | 'migration' | 'env'; text: string }[] = [];
  for (const r of releases) {
    if (!isNewerRelease(r, current)) continue;
    for (const g of r.groups) for (const it of g.items) for (const flag of it.flags) out.push({ flag, text: cleanNote(lang === 'en' && it.textEn ? it.textEn : it.text) });
  }
  return out;
}

/** the offered version can be installed unless it was skipped */
export const offered = (info: UpdateInfo | null): boolean => !!info?.available && !info.skipped;
