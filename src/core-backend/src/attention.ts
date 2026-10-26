/**
 * «Needs attention» for administrators:
 *   GET /api/admin/attention   the list (servers down, dead deliveries, backups, certificate, update, bot, disk, queues)
 * and a check of the free disk space every 30 minutes that sends a Discord alert (once per level per day).
 */
import fs from 'node:fs';
import type { Express, RequestHandler } from 'express';
import { DATA_DIR, db, getSetting, setSetting } from './db.js';
import { alertSettings, enqueueAlert } from './alerts.js';
import { backupSettings, listBackups } from './backup.js';
import { botStateNow } from './health.js';
import { log } from './logger.js';
import { inMaintenance } from './maintenance.js';
import { checkCert } from './ops.js';
import { updateWaitingLabel } from './routes/updates.js';
import { buildAttention, diskFreePct, diskLevel, shouldAlertDisk, type DiskLevel } from './attentionLogic.js';

const NAME_SQL = `COALESCE(NULLIF(s.name, ''), NULLIF(st.name, ''), NULLIF(s.display_address, ''), s.host || ':' || s.port)`;
const n = (sql: string): number => {
  try {
    return (db.prepare(sql).get() as { c: number }).c;
  } catch {
    return 0;
  }
};

function diskNow(): { free: number; total: number } | null {
  try {
    const st = fs.statfsSync(DATA_DIR);
    return { free: Number(st.bavail) * Number(st.bsize), total: Number(st.blocks) * Number(st.bsize) };
  } catch {
    return null;
  }
}

const gb = (b: number) => (b / 1024 ** 3).toFixed(1);

/** the low-disk message: also used by the message gallery in the admin */
export function diskEmbed(level: 'warn' | 'bad', free: number, total: number) {
  return {
    title: level === 'bad' ? '💾 Заканчивается место на диске' : '💾 Остаётся мало места на диске',
    description: `Свободно **${gb(free)} ГБ** из ${gb(total)} ГБ (**${diskFreePct(free, total)}%**).\nБэкапы, база и картинки хранятся на этом диске — освободите место, пока панель не начала сбоить.`,
    color: level === 'bad' ? 0xf23f42 : 0xf0b232,
  };
}

/** sends the low-disk alert when the level got worse or the trouble lasts for a day; returns whether it was sent */
export function checkDisk(now = Date.now()): boolean {
  const d = diskNow();
  const level = diskLevel(d?.free ?? null, d?.total ?? null);
  const last = (getSetting('disk_alert_level') as DiskLevel | null) ?? 'ok';
  const lastAt = Number(getSetting('disk_alert_at')) || 0;
  if (level === 'ok') {
    if (last !== 'ok') setSetting('disk_alert_level', 'ok');
    return false;
  }
  if (!d || !shouldAlertDisk(level, last === 'warn' || last === 'bad' ? last : 'ok', lastAt, now)) return false;
  setSetting('disk_alert_level', level);
  setSetting('disk_alert_at', String(now));
  const s = alertSettings();
  if (!s.enabled || !s.channelId) return false;
  enqueueAlert('disk', 'CoreGSM', {
    content: level === 'bad' ? (s.mention === 'everyone' ? '@everyone' : s.mention === 'here' ? '@here' : '') : '',
    mention: level === 'bad' ? s.mention : 'none',
    embed: diskEmbed(level, d.free, d.total),
  });
  return true;
}

export function registerAttention({ app, admin }: { app: Express; admin: RequestHandler }): void {
  app.get('/api/admin/attention', admin, async (_req, res) => {
    const now = Date.now();
    const down = (
      db.prepare(`SELECT s.id, ${NAME_SQL} AS name FROM servers s JOIN status st ON st.server_id = s.id WHERE st.online = 0 ORDER BY name`).all() as { id: number; name: string }[]
    ).filter((r) => !inMaintenance(r.id, now)).map((r) => r.name);
    const cert = await checkCert().catch(() => null);
    const bk = backupSettings();
    const last = listBackups().reduce<number | null>((m, b) => (m == null || b.createdAt > m ? b.createdAt : m), null);
    const items = buildAttention({
      now,
      serversDown: down,
      deadDeliveries: n(`SELECT COUNT(*) AS c FROM deliveries WHERE status = 'dead' AND created_at > ${now - 7 * 86_400_000}`),
      backup: { schedule: bk.schedule, lastAt: last },
      certDays: cert?.daysLeft ?? null,
      updateLabel: updateWaitingLabel(),
      botState: botStateNow(now) === 'none' ? 'online' : botStateNow(now),
      disk: diskNow(),
      pendingUsers: n("SELECT COUNT(*) AS c FROM users WHERE status = 'pending'"),
      openReports: n("SELECT COUNT(*) AS c FROM player_reports WHERE status = 'open'"),
      flaggedComments: n("SELECT COUNT(*) AS c FROM news_comments c WHERE c.status = 'visible' AND EXISTS (SELECT 1 FROM news_comment_flags f WHERE f.comment_id = c.id)"),
    });
    res.json({ at: now, items });
  });

  const tick = () => {
    try {
      checkDisk();
    } catch (e) {
      log.error('disk check failed', (e as Error).message);
    }
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 30 * 60_000).unref();
}
