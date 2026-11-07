/**
 * Tells the administrators (the alert channel of the panel) when the game plugin of a server has been silent for five minutes,
 * and again when it is back. A server that is restarting on purpose (a timer of «Рестарт сервера по таймеру» ran out less than
 * fifteen minutes ago) or is in a maintenance window is left alone.
 */
import { db, getSetting, setSetting } from '../db.js';
import { alertSettings, enqueueAlert } from '../alerts/alerts.js';
import { inMaintenance } from '../maintenance.js';
import { ONLINE_MS, serverLabel } from './gameNewsVars.js';
import { getJob } from './gameNewsRestartState.js';

export const SILENT_MS = 5 * 60_000;
const RESTART_GRACE_MS = 15 * 60_000;
const KEY = 'gamenews_silent';

const readAlerted = (): number[] => {
  try { return (JSON.parse(getSetting(KEY) || '[]') as unknown[]).filter((x): x is number => Number.isInteger(x)); } catch { return []; }
};

/** what a server's plugin is doing now: 'silent' (was seen, not for five minutes), 'ok', or 'never' (not connected yet) */
export function pluginState(lastSeen: number, now: number): 'never' | 'ok' | 'silent' {
  if (!lastSeen) return 'never';
  return now - lastSeen > SILENT_MS ? 'silent' : 'ok';
}

export function checkPluginSilence(now = Date.now()): number {
  const rows = db.prepare("SELECT server_id, last_seen FROM game_news_targets WHERE token_hash <> '' AND last_seen > 0").all() as { server_id: number; last_seen: number }[];
  const alerted = new Set(readAlerted());
  let sent = 0;
  const s = alertSettings();
  const say = (id: number, back: boolean, since: number) => {
    if (!s.enabled || !s.channelId) return;
    const name = serverLabel(id);
    enqueueAlert('update', name, {
      content: '', mention: 'none',
      embed: back
        ? { title: '✅ Игровой плагин снова на связи', description: `Сервер **${name}**: плагин CoreGSM отвечает.`, color: 0x3ba55d, timestamp: new Date(now).toISOString() }
        : { title: '⚠️ Игровой плагин не отвечает', description: `Сервер **${name}**: плагин CoreGSM не выходил на связь с ${new Date(since).toLocaleString('ru-RU')}. Сообщения в игру, чат в Discord и рестарт по таймеру не работают, пока он молчит. Проверьте, что сервер запущен и плагин установлен.`, color: 0xed4245, timestamp: new Date(now).toISOString() },
    });
    sent++;
  };
  for (const r of rows) {
    const st = pluginState(r.last_seen, now);
    if (st === 'silent' && !alerted.has(r.server_id)) {
      const job = getJob(r.server_id);
      if (job && (job.state === 'sent' || job.state === 'due') && now - job.run_at < RESTART_GRACE_MS) continue;
      if (inMaintenance(r.server_id, now)) continue;
      alerted.add(r.server_id);
      say(r.server_id, false, r.last_seen);
    } else if (st === 'ok' && alerted.has(r.server_id) && now - r.last_seen < ONLINE_MS * 2) {
      alerted.delete(r.server_id);
      say(r.server_id, true, r.last_seen);
    }
  }
  // a server that lost its token or was removed must not stay in the list
  const known = new Set(rows.map((r) => r.server_id));
  for (const id of [...alerted]) if (!known.has(id)) alerted.delete(id);
  setSetting(KEY, alerted.size ? JSON.stringify([...alerted]) : null);
  return sent;
}
