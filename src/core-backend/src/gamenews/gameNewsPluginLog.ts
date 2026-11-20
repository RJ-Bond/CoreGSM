/**
 * What the plugin tells the panel about itself, for the journal («Игровой плагин» → «Журнал»):
 *  - notes (`POST /api/game-news/incidents`): several players leaving at once, a high ping, the lines of Steam, a freeze, a save;
 *  - the result of every message it showed (`POST /api/game-news/delivery`): how many players saw it, or why it could not be shown.
 * Three messages in a row that did not reach the game tell the administrators (the service channel).
 * The journal is kept for `gamenews_journal_days` days (30 by default).
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { db, getSetting, setSetting } from '../db.js';
import { systemTarget } from '../alerts/alertRoute.js';
import { alertSettings, enqueueAlert } from '../alerts/alerts.js';
import { expireOld, pluginTarget } from './gameNews.js';
import { alertOnce } from './gameNewsConnections.js';
import { plainLine } from './gameNewsJoinLeave.js';
import { serverLabel } from './gameNewsVars.js';

db.exec(`
CREATE TABLE IF NOT EXISTS game_plugin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_game_plugin_log ON game_plugin_log(server_id, ts);
`);

/** what the plugin may report; an unknown kind is kept as «other» */
export const PLUGIN_NOTE_KINDS = ['mass', 'ping', 'steam', 'freeze', 'save'] as const;
export type PluginNoteKind = (typeof PLUGIN_NOTE_KINDS)[number] | 'other';

export const DEFAULT_JOURNAL_DAYS = 30;
const PER_SERVER_CAP = 2000;
/** this many messages in a row that did not reach the game are told to the administrators */
export const FAIL_STREAK_ALERT = 3;

export const journalDays = (): number => {
  const n = Number(getSetting('gamenews_journal_days'));
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_JOURNAL_DAYS;
};

export interface PluginNote { kind: string; text: string; name?: string; at: number }

/** keeps the notes of a server; the time of the plugin counts unless its clock is far off */
export function savePluginNotes(serverId: number, items: PluginNote[], now = Date.now()): number {
  const insert = db.prepare('INSERT INTO game_plugin_log (server_id, ts, kind, name, text) VALUES (?, ?, ?, ?, ?)');
  let n = 0;
  db.transaction(() => {
    for (const it of items) {
      const text = plainLine(it.text).slice(0, 500);
      if (!text) continue;
      const kind = (PLUGIN_NOTE_KINDS as readonly string[]).includes(it.kind) ? it.kind : 'other';
      const ts = Math.abs(it.at - now) < 3_600_000 ? it.at : now;
      insert.run(serverId, ts, kind, plainLine(it.name ?? '').slice(0, 100), text);
      n++;
    }
    db.prepare('DELETE FROM game_plugin_log WHERE server_id = ? AND id NOT IN (SELECT id FROM game_plugin_log WHERE server_id = ? ORDER BY id DESC LIMIT ?)').run(serverId, serverId, PER_SERVER_CAP);
  })();
  return n;
}

/** forgets what is older than the days of the journal (messages, notes); returns how many rows went */
export function pruneJournal(days: number, now = Date.now()): number {
  const limit = now - days * 86_400_000;
  const a = db.prepare("DELETE FROM game_news_log WHERE sent_at < ? AND status <> 'queued'").run(limit).changes;
  const b = db.prepare('DELETE FROM game_plugin_log WHERE ts < ?').run(limit).changes;
  const c = db.prepare('DELETE FROM game_restart_log WHERE started_at < ?').run(limit).changes;
  return a + b + c;
}
let lastPrune = 0;
/** not more often than once an hour */
export function pruneJournalSometimes(now = Date.now()): void {
  if (now - lastPrune < 3_600_000) return;
  lastPrune = now;
  try { pruneJournal(journalDays(), now); } catch { /* the journal stays as it is */ }
}

export interface DeliveryResult { id: number; /** players who saw it; -1 = it could not be shown */ shown: number; reason?: string }

/** what the plugin says about the messages it took: how many players saw each, or why it did not show */
export function saveDelivery(serverId: number, results: DeliveryResult[], now = Date.now()): { updated: number; alerted: boolean } {
  const seen = db.prepare("UPDATE game_news_log SET shown = ? WHERE id = ? AND server_id = ? AND status IN ('delivered', 'queued')");
  const failed = db.prepare("UPDATE game_news_log SET status = 'failed', ok = 0, shown = -1, error = ? WHERE id = ? AND server_id = ?");
  let updated = 0;
  db.transaction(() => {
    for (const r of results) {
      const info = r.shown >= 0 ? seen.run(Math.min(r.shown, 10_000), r.id, serverId) : failed.run(plainLine(r.reason ?? '').slice(0, 200) || 'Плагин не смог показать сообщение', r.id, serverId);
      updated += info.changes;
    }
  })();
  return { updated, alerted: results.some((r) => r.shown < 0) && checkFailStreak(serverId, now) };
}

/** the last messages of a server did not reach the game three times in a row: one message to the administrators */
export function checkFailStreak(serverId: number, now = Date.now()): boolean {
  const last = db.prepare("SELECT status FROM game_news_log WHERE server_id = ? AND status <> 'queued' ORDER BY id DESC LIMIT ?").all(serverId, FAIL_STREAK_ALERT) as { status: string }[];
  if (last.length < FAIL_STREAK_ALERT || !last.every((r) => r.status === 'failed' || r.status === 'expired')) return false;
  return alertOnce(`delivery:${serverId}`, now, () => {
    if (!systemTarget(alertSettings())) return;
    const name = serverLabel(serverId);
    enqueueAlert('update', name, {
      content: '', mention: 'none',
      embed: {
        title: '✉ Сообщения не доходят до игры',
        description: `Сервер **${name}**: ${FAIL_STREAK_ALERT} сообщения подряд не показаны игрокам. Проверьте, что сервер запущен и плагин на связи: «Игровой плагин» → «Журнал».`,
        color: 0xed4245,
        timestamp: new Date(now).toISOString(),
      },
    });
  });
}

/** messages that nobody took expire (the plugin may be dead, then nobody asks): marks them and tells when three in a row did not reach the game; called by the timer */
export function sweepQueue(now = Date.now()): void {
  expireOld(now);
  const rows = db.prepare("SELECT DISTINCT server_id FROM game_news_log WHERE status = 'expired' AND sent_at > ? AND server_id IS NOT NULL").all(now - 3_600_000) as { server_id: number }[];
  for (const r of rows) checkFailStreak(r.server_id, now);
}

const noteSchema = z.object({
  items: z.array(z.object({ kind: z.string().max(20), text: z.string().max(2000), name: z.string().max(300).optional(), at: z.number().int().positive() })).max(50),
});
const deliverySchema = z.object({
  results: z.array(z.object({ id: z.number().int().positive(), shown: z.number().int().min(-1).max(100_000), reason: z.string().max(300).optional() })).max(100),
});

export function registerGameNewsPluginLog({ app, admin }: { app: Express; admin: RequestHandler }): void {
  app.post('/api/game-news/incidents', (req, res) => {
    const t = pluginTarget(req);
    if (!t) return res.status(401).json({ error: 'unauthorized' });
    const b = noteSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad' });
    res.json({ ok: true, saved: savePluginNotes(t.server_id, b.data.items) });
  });

  app.post('/api/game-news/delivery', (req, res) => {
    const t = pluginTarget(req);
    if (!t) return res.status(401).json({ error: 'unauthorized' });
    const b = deliverySchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad' });
    res.json({ ok: true, ...saveDelivery(t.server_id, b.data.results) });
  });

  // the days the journal is kept for (administrators)
  app.put('/api/game-news/journal/settings', admin, (req, res) => {
    const b = z.object({ days: z.number().int().min(1).max(365) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    setSetting('gamenews_journal_days', String(b.data.days));
    res.json({ days: b.data.days });
  });

  // «Очистить старше N дней»
  app.delete('/api/game-news/journal', admin, (req, res) => {
    const days = Number(req.query.olderThanDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) return res.status(400).json({ error: 'Проверьте поля' });
    res.json({ removed: pruneJournal(days) });
  });
}
