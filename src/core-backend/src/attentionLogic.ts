/** The admin «needs attention» list: pure rules (what is shown and in which order), no I/O. */
export type AttentionTone = 'bad' | 'warn' | 'info';
export type AttentionKind =
  | 'servers_down' | 'deliveries_dead' | 'backup_none' | 'backup_old' | 'cert' | 'update' | 'bot' | 'disk' | 'users_pending' | 'reports' | 'comments';

export interface AttentionItem {
  id: AttentionKind;
  tone: AttentionTone;
  /** the number or text the sentence is built from (days, count, percent, names, ...) */
  n?: number;
  text?: string;
  /** panel section the item leads to */
  href: string;
}

export interface AttentionInput {
  now: number;
  serversDown: string[];
  deadDeliveries: number;
  backup: { schedule: 'off' | 'daily' | 'weekly'; lastAt: number | null };
  certDays: number | null;
  updateLabel: string | null;
  botState: string;
  disk: { free: number; total: number } | null;
  pendingUsers: number;
  openReports: number;
  flaggedComments: number;
}

const DAY = 86_400_000;
const GB = 1024 ** 3;

export type DiskLevel = 'ok' | 'warn' | 'bad';
/** less than 15 % free is a warning, less than 7 % (or under 1 GB) is an alarm */
export function diskLevel(free: number | null, total: number | null): DiskLevel {
  if (free == null || total == null || total <= 0) return 'ok';
  const pct = (free / total) * 100;
  if (free < GB || pct < 7) return 'bad';
  if (pct < 15) return 'warn';
  return 'ok';
}
export const diskFreePct = (free: number, total: number): number => (total > 0 ? Math.round((free / total) * 100) : 0);

/** a backup older than this is "old" for the schedule */
export const backupMaxAgeDays = (s: 'daily' | 'weekly' | 'off'): number => (s === 'daily' ? 3 : s === 'weekly' ? 10 : 14);

const RANK: Record<AttentionTone, number> = { bad: 0, warn: 1, info: 2 };

export function buildAttention(i: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (i.serversDown.length) out.push({ id: 'servers_down', tone: 'bad', n: i.serversDown.length, text: i.serversDown.slice(0, 3).join(', '), href: '/admin/servers' });
  if (i.botState === 'error' || i.botState === 'offline') out.push({ id: 'bot', tone: 'bad', text: i.botState, href: '/admin/discord' });
  const lvl = diskLevel(i.disk?.free ?? null, i.disk?.total ?? null);
  if (i.disk && lvl !== 'ok') out.push({ id: 'disk', tone: lvl, n: diskFreePct(i.disk.free, i.disk.total), href: '/admin/system' });
  if (i.deadDeliveries > 0) out.push({ id: 'deliveries_dead', tone: 'warn', n: i.deadDeliveries, href: '/admin/alerts' });
  if (i.certDays != null && i.certDays <= 14) out.push({ id: 'cert', tone: i.certDays <= 3 ? 'bad' : 'warn', n: i.certDays, href: '/admin/system' });
  if (i.backup.lastAt == null) {
    out.push({ id: 'backup_none', tone: 'warn', href: '/admin/settings/backups' });
  } else {
    const days = Math.floor((i.now - i.backup.lastAt) / DAY);
    if (days > backupMaxAgeDays(i.backup.schedule)) out.push({ id: 'backup_old', tone: 'warn', n: days, href: '/admin/settings/backups' });
  }
  if (i.pendingUsers > 0) out.push({ id: 'users_pending', tone: 'info', n: i.pendingUsers, href: '/admin/users' });
  if (i.openReports > 0) out.push({ id: 'reports', tone: 'info', n: i.openReports, href: '/admin/community' });
  if (i.flaggedComments > 0) out.push({ id: 'comments', tone: 'info', n: i.flaggedComments, href: '/admin/community' });
  if (i.updateLabel) out.push({ id: 'update', tone: 'info', text: i.updateLabel, href: '/admin/settings/updates' });
  return out.map((x, k) => ({ x, k })).sort((a, b) => RANK[a.x.tone] - RANK[b.x.tone] || a.k - b.k).map((e) => e.x);
}

/** whether the disk alert must be sent now: the level got worse, or the same trouble lasts for a day */
export function shouldAlertDisk(level: DiskLevel, lastLevel: DiskLevel, lastAt: number, now: number): boolean {
  if (level === 'ok') return false;
  if (lastLevel === 'ok') return true;
  if (level === 'bad' && lastLevel === 'warn') return true;
  return now - lastAt >= DAY;
}
