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

export interface NotesItem { text: string; textEn: string | null; flags: CommitFlag[] }
export interface NotesGroup { title: string; titleEn: string | null; items: NotesItem[] }
export interface NotesRelease { version: string | null; date: string | null; groups: NotesGroup[] }

/** «Русский | English» → both parts; a line without « | » has no English part */
export function splitLang(text: string): { ru: string; en: string | null } {
  const i = text.indexOf(' | ');
  if (i < 0) return { ru: text.trim(), en: null };
  const ru = text.slice(0, i).trim();
  let en = text.slice(i + 3).trim();
  // the emoji is written once, in front of the Russian part; the English one carries it too
  const e = /^(\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}]*)\s+/u.exec(ru);
  if (e && en && !/^\p{Extended_Pictographic}/u.test(en)) en = `${e[1]} ${en}`;
  return { ru, en: en || null };
}

/**
 * CHANGELOG.md of the repository, in Russian and English on one line (« | »), emoji first:
 *   ## Не выпущено | Unreleased          (version null)
 *   ## 1.0.0.7 · 26.10.2026
 *   ### ✨ Новое | New
 *   - 🧩 что изменилось [migration] | what changed
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
      group = null;
      // only «1.2.3.4 · date» and «Не выпущено | Unreleased» are releases; any other heading (the rules at the top) is skipped
      if (!m && !/^(не выпущено|unreleased)/i.test(h2[1]!.trim())) { rel = null; continue; }
      rel = { version: m ? m[1]! : null, date: m?.[2]?.trim() ?? null, groups: [] };
      out.push(rel);
      continue;
    }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3 && rel) {
      const l = splitLang(h3[1]!);
      group = { title: l.ru, titleEn: l.en, items: [] };
      rel.groups.push(group);
      continue;
    }
    const li = /^[-*]\s+(.+)$/.exec(line);
    if (li && rel) {
      if (!group) { group = { title: 'Изменения', titleEn: 'Changes', items: [] }; rel.groups.push(group); }
      const l = splitLang(li[1]!);
      group.items.push({ text: l.ru, textEn: l.en, flags: flagsOf(li[1]!) });
    }
  }
  return out;
}

/** the releases (newest first, as in CHANGELOG.md) after `from` up to and including `to`; without a known `from` only `to` itself */
export function notesBetween(releases: NotesRelease[], from: string | null | undefined, to: string | null | undefined): NotesRelease[] {
  if (!parseVersion(to)) return [];
  return releases.filter((r) => {
    if (!r.version) return false;
    const upTo = cmpVersion(r.version, to);
    if (upTo === null || upTo > 0) return false;
    if (!parseVersion(from)) return upTo === 0;
    const after = cmpVersion(r.version, from);
    return after !== null && after > 0;
  });
}

/** the notes as Discord text: a bold group title and a bullet per item; several releases get their version as a heading; cut at `max` characters */
export function notesText(releases: NotesRelease[], max = 1500): string {
  const lines: string[] = [];
  const multi = releases.length > 1;
  let total = 0;
  let left = 0;
  for (const r of releases) {
    const block: string[] = [];
    if (multi && r.version) block.push(`**${r.version}**`);
    for (const g of r.groups) {
      if (g.items.length === 0) continue;
      block.push(`__${g.title.replace(/^[^\p{L}\p{N}]+/u, '').trim() || g.title}__`);
      for (const it of g.items) block.push(`• ${it.text.trim()}`);
    }
    for (const l of block) {
      if (total + l.length + 1 > max) { if (l.startsWith('• ')) left++; continue; }
      lines.push(l);
      total += l.length + 1;
    }
  }
  if (left > 0) lines.push(`… и ещё ${left}`);
  return lines.join('\n');
}

// ---- the notices about updates in Discord ----
export type NoticeLang = 'ru' | 'en';
export const parseNoticeLang = (v: string | null | undefined): NoticeLang => (v === 'en' ? 'en' : 'ru');
/** days before the reminder about a version nobody installed; 0 = no reminder, 7 when not set */
export function parseRemindDays(v: string | null | undefined): number {
  if (v == null || v === '') return 7;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 60 ? n : 7;
}

/** «26.10.2026» → whole days since that date (null when the date is not readable or in the future) */
export function releaseAgeDays(date: string | null | undefined, now: number): number | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec((date ?? '').trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (!Number.isFinite(t) || t > now) return null;
  return Math.floor((now - t) / 86_400_000);
}

export function daysAgoText(days: number, lang: NoticeLang): string {
  if (lang === 'en') return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  if (days === 0) return 'сегодня';
  if (days === 1) return 'вчера';
  const d = days % 100 >= 11 && days % 100 <= 14 ? 'дней' : days % 10 === 1 ? 'день' : days % 10 >= 2 && days % 10 <= 4 ? 'дня' : 'дней';
  return `${days} ${d} назад`;
}

/** warnings from the flags of the items: a migration, new settings, a breaking change (each shown once) */
export function noticeWarnings(releases: NotesRelease[], lang: NoticeLang): string[] {
  const flags = new Set<CommitFlag>();
  for (const r of releases) for (const g of r.groups) for (const it of g.items) it.flags.forEach((f) => flags.add(f));
  const out: string[] = [];
  if (flags.has('breaking')) out.push(lang === 'en' ? '⚠️ Contains incompatible changes' : '⚠️ Есть несовместимые изменения');
  if (flags.has('migration')) out.push(lang === 'en' ? '🗄️ The database will be upgraded' : '🗄️ База данных будет обновлена');
  if (flags.has('env')) out.push(lang === 'en' ? '⚙️ New settings are needed (.env)' : '⚙️ Нужны новые настройки (.env)');
  return out;
}

/** the groups of the releases as embed fields: «name» is the group (with the version when there are several releases) */
export function noticeFields(releases: NotesRelease[], lang: NoticeLang, limits = { field: 1000, count: 10, total: 4200 }): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const multi = releases.length > 1;
  let total = 0;
  let left = 0;
  for (const r of releases) {
    for (const g of r.groups) {
      const items = g.items.map((it) => `• ${(lang === 'en' ? it.textEn ?? it.text : it.text).trim()}`);
      if (items.length === 0) continue;
      const name = `${multi && r.version ? `${r.version} · ` : ''}${(lang === 'en' ? g.titleEn ?? g.title : g.title)}`.slice(0, 250);
      const lines: string[] = [];
      let len = 0;
      for (const l of items) {
        if (len + l.length + 1 > limits.field || total + len + l.length + name.length > limits.total) { left++; continue; }
        lines.push(l);
        len += l.length + 1;
      }
      if (lines.length === 0 || out.length >= limits.count) { left += lines.length; continue; }
      out.push({ name, value: lines.join('\n') });
      total += len + name.length;
    }
  }
  if (left > 0 && out.length > 0) {
    const last = out[out.length - 1]!;
    const more = lang === 'en' ? `… and ${left} more` : `… и ещё ${left}`;
    if (last.value.length + more.length + 1 <= 1024) last.value += `\n${more}`;
  }
  return out;
}

/** a reminder is sent once per version: the notices are on, a version is waiting for `remindDays` days since the first notice, and no reminder was sent for it yet */
export function shouldRemind(o: { notify: boolean; remindDays: number; available: boolean; latest: string | null; announced: string | null; announcedAt: number | null; reminded: string | null; skipped: string | null; now: number }): boolean {
  if (!o.notify || o.remindDays <= 0 || !o.available || !o.latest) return false;
  if (o.latest !== o.announced || o.latest === o.skipped || o.latest === o.reminded) return false;
  return o.announcedAt != null && o.now - o.announcedAt >= o.remindDays * 86_400_000;
}

export interface Notice { title: string; description: string; fields: { name: string; value: string }[]; footer: string; color: number }

/** the text of a notice: «available» (a new version), «reminder» (nobody installed it) and «done» (the panel was updated) */
export function buildNotice(o: { kind: 'available' | 'reminder' | 'done'; lang: NoticeLang; from: string | null; to: string | null; releases: NotesRelease[]; line: string; now: number }): Notice {
  const en = o.lang === 'en';
  const between = notesBetween(o.releases, o.from, o.to);
  const target = o.releases.find((r) => r.version === o.to);
  const age = releaseAgeDays(target?.date, o.now);
  const arrow = o.from && o.to && o.from !== o.to ? `${o.from} → ${o.to}` : o.to ?? '';
  const skipped = Math.max(0, between.length - 1);
  const lines: string[] = [o.line];
  if (skipped > 0) lines.push(en ? `Versions in between: ${skipped}` : `Пропущено версий между ними: ${skipped}`);
  lines.push(...noticeWarnings(between, o.lang));
  if (o.kind !== 'done') lines.push(en ? 'Install: Settings → Updates and backups.' : 'Установить: Настройки → Обновления и копии.');
  const title = o.kind === 'available' ? (en ? 'Panel update available' : 'Доступно обновление панели')
    : o.kind === 'reminder' ? (en ? 'Reminder: panel update is waiting' : 'Напоминание: обновление панели ждёт')
    : (en ? 'Panel updated' : 'Панель обновлена');
  let footer = '';
  if (target?.date) footer = en ? `Released ${target.date}${age != null ? ` · ${daysAgoText(age, 'en')}` : ''}` : `Вышла ${target.date}${age != null ? ` · ${daysAgoText(age, 'ru')}` : ''}`;
  return { title: arrow ? `${title}: ${arrow}` : title, description: lines.join('\n'), fields: noticeFields(between, o.lang), footer, color: o.kind === 'done' ? 0x23a55a : o.kind === 'reminder' ? 0xf0b232 : 0x5865f2 };
}
