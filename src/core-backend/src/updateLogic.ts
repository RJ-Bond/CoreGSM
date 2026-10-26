/** Pure parts of the updates tab: what stage a host job is in, how a commit is classified, what to announce. */

export type JobLike = { state: string; message: string; time: number; progress?: number } | null;

export type Stage = 'download' | 'snapshot' | 'install' | 'health' | 'rollback';
export const STAGES: Stage[] = ['download', 'snapshot', 'install', 'health'];

/**
 * The host manager (tools/coregsm.sh) reports a percent and a message: 6 download, 12 copy of data and images,
 * 20..96 installer, 97 health check; a rollback says so in the message. The stage is derived from that, so an old
 * manager works too. null: nothing is running.
 */
export function stageOf(job: JobLike): Stage | null {
  if (!job || job.state !== 'running') return null;
  if (/откат/i.test(job.message)) return 'rollback';
  const p = job.progress;
  if (typeof p !== 'number') return 'download';
  if (p < 12) return 'download';
  if (p < 20) return 'snapshot';
  if (p < 97) return 'install';
  return 'health';
}

/** 'rollback' for a job that restored the previous version, else 'update' */
export const jobKind = (message: string): 'update' | 'rollback' => (/^\s*откат/i.test(message) || /выполнен откат/i.test(message) ? 'rollback' : 'update');

/** «Уже установлена последняя версия»: nothing happened, not worth a history row */
export const isNoopJob = (message: string): boolean => /^\s*уже установлена/i.test(message);

export type CommitKind = 'feat' | 'fix' | 'other' | 'merge';
export type CommitFlag = 'breaking' | 'migration' | 'env';

/** «feat(ui): …» → feat; «Merge pull request…» and «merge main into …» → merge; the flags come from the whole message */
export function classifyCommit(message: string): { kind: CommitKind; flags: CommitFlag[] } {
  const title = (message.split(/\r?\n/)[0] ?? '').trim();
  let kind: CommitKind = 'other';
  if (/^merge\b/i.test(title)) kind = 'merge';
  else if (/^feat(\(.+?\))?!?:/i.test(title)) kind = 'feat';
  else if (/^fix(\(.+?\))?!?:/i.test(title)) kind = 'fix';
  const flags: CommitFlag[] = [];
  if (/^\w+(\(.+?\))?!:/.test(title) || /BREAKING[ -]CHANGE/.test(message)) flags.push('breaking');
  if (/\[(migration|db)\]/i.test(message) || /миграци/i.test(message)) flags.push('migration');
  if (/\[env\]/i.test(message)) flags.push('env');
  return { kind, flags };
}

/** a new version is announced once per build, and never when it was skipped or the notices are off */
export function shouldAnnounce(o: { notify: boolean; available: boolean; latest: string | null; announced: string | null; skipped: string | null }): boolean {
  return o.notify && o.available && !!o.latest && o.latest !== o.announced && o.latest !== o.skipped;
}

export type Channel = 'release' | 'main';
export const parseChannel = (v: string | null | undefined): Channel => (v === 'main' ? 'main' : 'release');

/** «1.0.0.12» → [1,0,0,12]; anything else (a bare hash) → null */
export function parseVersion(v: string | null | undefined): number[] | null {
  if (!v || !/^\d+(\.\d+){1,4}$/.test(v)) return null;
  return v.split('.').map(Number);
}

/** negative when a < b; null when either is not a readable version */
export function cmpVersion(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function flagsOf(text: string): CommitFlag[] {
  return classifyCommit(text.replace(/^[-*]\s*/, '')).flags.concat(/^[-*]?\s*⚠/.test(text) ? ['breaking' as const] : []).filter((f, i, a) => a.indexOf(f) === i);
}

export interface NotesGroup { title: string; items: { text: string; flags: CommitFlag[] }[] }
export interface NotesRelease { version: string | null; date: string | null; groups: NotesGroup[] }

/**
 * CHANGELOG.md of the repository:
 *   ## Не выпущено                      (version null)
 *   ## 1.0.0.7 · 26.10.2026
 *   ### Новое
 *   - what changed [migration]
 * Sections come newest first, as written.
 */
export function parseChangelog(text: string): NotesRelease[] {
  const out: NotesRelease[] = [];
  let rel: NotesRelease | null = null;
  let group: NotesGroup | null = null;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2 && !line.startsWith('###')) {
      const m = /^(\d+(?:\.\d+){1,4})(?:\s*[·—–-]\s*(.+))?$/.exec(h2[1]!.trim());
      rel = { version: m ? m[1]! : null, date: m?.[2]?.trim() ?? null, groups: [] };
      group = null;
      out.push(rel);
      continue;
    }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3 && rel) {
      group = { title: h3[1]!.trim(), items: [] };
      rel.groups.push(group);
      continue;
    }
    const li = /^[-*]\s+(.+)$/.exec(line);
    if (li && rel) {
      if (!group) { group = { title: 'Изменения', items: [] }; rel.groups.push(group); }
      group.items.push({ text: li[1]!.trim(), flags: flagsOf(li[1]!) });
    }
  }
  return out;
}
