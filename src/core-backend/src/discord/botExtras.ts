/**
 * More for the bot:
 *   POST /internal/discord/follow       «🔔 Следить» under a server card or a player card (the account is found by Discord id)
 *   GET|PUT /api/settings/dashboard     the live dashboard message (one message with all servers, edited by the bot) and the
 *                                       weekly summary for the administrators
 *   GET|PATCH /internal/dashboard       what the bot needs to keep the dashboard up to date
 * The weekly summary: every Monday from 09:00 (server time) the administrators with a linked Discord get a private card.
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { db, EFFECTIVE_NAME, getSetting, setSetting } from '../db.js';
import { queueCard } from '../alerts/dmQueue.js';
import { weeklyCard, weeklyDue, type WeeklyStats } from '../alerts/dmCard.js';
import { bot, channelInfo } from './botState.js';
import { dmAvailable, SUB_KINDS } from '../community/subscriptions.js';
import { MAX_FOLLOWS, nickKey, validNick } from '../profile/playerFollows.js';
import { log } from '../logger.js';

const WEEK = 7 * 86_400_000;

export const dashboardSettings = () => ({
  enabled: getSetting('dash_enabled') === '1' && /^\d{15,25}$/.test(getSetting('dash_channel') ?? ''),
  channelId: getSetting('dash_channel') ?? '',
  messageId: getSetting('dash_message') ?? '',
  error: getSetting('dash_error') ?? '',
  /** the weekly summary for the administrators is on unless it was switched off */
  weekly: getSetting('admin_weekly') !== '0',
});

/** numbers of the last seven days (and the peak of the week before) */
export function weeklyStats(now: number): WeeklyStats {
  const from = now - WEEK;
  const peakOf = (a: number, b: number) =>
    db
      .prepare('SELECT SUM(players) AS n, MIN(ts) AS t FROM history WHERE ts >= ? AND ts < ? AND online = 1 GROUP BY ts / 60000 ORDER BY n DESC LIMIT 1')
      .get(a, b) as { n: number; t: number } | undefined;
  const peak = peakOf(from, now);
  const prev = peakOf(from - WEEK, from);
  const one = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;
  const cases = (kind: string) => one("SELECT COUNT(*) AS n FROM mod_cases WHERE kind = ? AND created_at >= ?", kind, from);
  return {
    from,
    to: now,
    peak: peak?.n ?? 0,
    peakPrev: prev?.n ?? 0,
    peakAt: peak?.t ?? null,
    newPlayers: one('SELECT COUNT(*) AS n FROM (SELECT ulower(name) AS k, MIN(joined_at) AS m FROM player_sessions GROUP BY k HAVING m >= ?)', from),
    activePlayers: one('SELECT COUNT(DISTINCT ulower(name)) AS n FROM player_sessions WHERE joined_at >= ? OR left_at IS NULL', from),
    newAccounts: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', from),
    warns: cases('warn'),
    bans: cases('ban'),
    kicks: cases('kick'),
    mutes: cases('timeout'),
    reports: one('SELECT COUNT(*) AS n FROM player_reports WHERE created_at >= ?', from),
  };
}

/** Sends the summary when it is due; returns how many administrators got it. Never throws. */
export function sendWeekly(now = Date.now(), force = false): number {
  try {
    if (!dashboardSettings().weekly && !force) return 0;
    const tz = getSetting('timezone') || process.env.TZ || 'Europe/Moscow';
    const last = Number(getSetting('admin_weekly_at') ?? 0) || 0;
    if (!force && !weeklyDue(now, last, tz)) return 0;
    if (!dmAvailable()) return 0;
    const admins = db.prepare("SELECT id, discord_id FROM users WHERE role = 'admin' AND status = 'active' AND discord_id IS NOT NULL").all() as { id: number; discord_id: string }[];
    const stats = weeklyStats(now);
    setSetting('admin_weekly_at', String(now));
    for (const a of admins) queueCard({ userId: a.id, discordId: a.discord_id, kind: 'weekly', card: (c) => weeklyCard(c, stats) }, now);
    return admins.length;
  } catch (e) {
    log.error('weekly summary failed', (e as Error).message);
    return 0;
  }
}

let timer: NodeJS.Timeout | null = null;
export function startWeekly(): void {
  if (timer) return;
  timer = setInterval(() => void sendWeekly(), 10 * 60_000);
  timer.unref();
}

export function registerBotExtras(deps: { app: Express; admin: RequestHandler; internal: RequestHandler }): void {
  const { app, admin, internal } = deps;

  // ----- «🔔 Следить» -----
  app.post('/internal/discord/follow', internal, (req, res) => {
    const b = z
      .object({
        discordId: z.string().regex(/^\d{15,25}$/),
        kind: z.enum(['server', 'player']),
        serverId: z.number().int().min(1).optional(),
        nick: z.string().max(64).optional(),
        on: z.boolean(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad body' });
    const u = db.prepare("SELECT id FROM users WHERE discord_id = ? AND status = 'active'").get(b.data.discordId) as { id: number } | undefined;
    if (!u) return res.json({ status: 'unlinked' });
    if (b.data.kind === 'server') {
      const sid = b.data.serverId ?? 0;
      const s = db.prepare(`SELECT ${EFFECTIVE_NAME} AS n FROM servers s LEFT JOIN status st ON st.server_id = s.id WHERE s.id = ?`).get(sid) as { n: string } | undefined;
      if (!s) return res.json({ status: 'notfound' });
      db.transaction(() => {
        for (const k of SUB_KINDS) {
          if (b.data.on) db.prepare('INSERT OR IGNORE INTO server_subscriptions (user_id, server_id, kind, created_at) VALUES (?, ?, ?, ?)').run(u.id, sid, k, Date.now());
          else db.prepare('DELETE FROM server_subscriptions WHERE user_id = ? AND server_id = ? AND kind = ?').run(u.id, sid, k);
        }
      })();
      return res.json({ status: 'ok', on: b.data.on, name: s.n });
    }
    const nick = (b.data.nick ?? '').trim();
    if (!validNick(nick)) return res.json({ status: 'notfound' });
    const key = nickKey(nick);
    if (b.data.on) {
      const have = db.prepare('SELECT 1 FROM player_follows WHERE user_id = ? AND nick_key = ?').get(u.id, key);
      if (!have) {
        const n = (db.prepare('SELECT COUNT(*) AS n FROM player_follows WHERE user_id = ?').get(u.id) as { n: number }).n;
        if (n >= MAX_FOLLOWS) return res.json({ status: 'limit', max: MAX_FOLLOWS });
        db.prepare('INSERT INTO player_follows (user_id, nick_key, nick, created_at) VALUES (?, ?, ?, ?)').run(u.id, key, nick, Date.now());
      }
    } else {
      db.prepare('DELETE FROM player_follows WHERE user_id = ? AND nick_key = ?').run(u.id, key);
    }
    res.json({ status: 'ok', on: b.data.on, name: nick });
  });

  // ----- dashboard -----
  const payload = () => {
    const s = dashboardSettings();
    return { enabled: getSetting('dash_enabled') === '1', channelId: s.channelId, channelName: channelInfo(s.channelId).channelName, error: s.error, weekly: s.weekly, botOnline: bot.status.state === 'online' };
  };
  app.get('/api/settings/dashboard', admin, (_req, res) => res.json(payload()));
  app.put('/api/settings/dashboard', admin, (req, res) => {
    const b = z.object({ enabled: z.boolean().optional(), channelId: z.string().regex(/^(\d{15,25})?$/).optional(), weekly: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте канал' });
    if (b.data.channelId !== undefined && b.data.channelId !== (getSetting('dash_channel') ?? '')) {
      // another channel: the old message is forgotten, the bot posts a new one
      setSetting('dash_channel', b.data.channelId);
      setSetting('dash_message', '');
      setSetting('dash_error', '');
    }
    if (b.data.enabled !== undefined) setSetting('dash_enabled', b.data.enabled ? '1' : '0');
    if (b.data.weekly !== undefined) setSetting('admin_weekly', b.data.weekly ? '1' : '0');
    res.json(payload());
  });
  // a test of the weekly summary: sent to the administrators at once
  app.post('/api/settings/dashboard/weekly-test', admin, (_req, res) => res.json({ sent: sendWeekly(Date.now(), true) }));

  app.get('/internal/dashboard', internal, (_req, res) => {
    const s = dashboardSettings();
    if (!s.enabled) return res.status(404).json({ error: 'off' });
    res.json({ channelId: s.channelId, messageId: s.messageId || null });
  });
  app.patch('/internal/dashboard', internal, (req, res) => {
    const b = z.object({ messageId: z.string().regex(/^\d{15,25}$/).optional(), error: z.string().max(300).nullable().optional() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad body' });
    if (b.data.messageId !== undefined) setSetting('dash_message', b.data.messageId);
    if (b.data.error !== undefined) setSetting('dash_error', b.data.error ?? '');
    res.json({ ok: true });
  });
}
