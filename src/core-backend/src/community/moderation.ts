/**
 * Settings of the moderation commands of the bot (/clear, /ban, /unban, /kick, /warn):
 *   GET|PUT /api/settings/moderation   { enabled, logChannelId, protectedChannels, cooldown }   (admin)
 *   GET /internal/moderation   the same for the bot, read at each command
 *   POST /internal/warns   { guildId, userId, modId, reason }   records a warning, answers { id, total, recent }
 *   GET /internal/warns?guild=&user=   the warnings of a member
 * `protectedChannels` are never cleaned; `logChannelId` receives a record of each cleaning; `cooldown` is the pause in
 * minutes between two cleanings of one channel.
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { db, getSetting, setSetting } from '../db.js';
import { bot } from '../discord/botState.js';
import { MAX_COOLDOWN, MAX_PROTECTED, cleanCooldown, cleanIds, parseIds } from './moderationLogic.js';

db.exec(`
CREATE TABLE IF NOT EXISTS mod_warns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  mod_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mod_warns_user ON mod_warns(guild_id, user_id, id);
`);

const RECENT = 3;
const recentWarns = (guild: string, user: string, limit = RECENT) =>
  (db.prepare('SELECT id, mod_id AS modId, reason, created_at AS createdAt FROM mod_warns WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?').all(guild, user, limit) as { id: number; modId: string; reason: string; createdAt: number }[]);
const totalWarns = (guild: string, user: string) => (db.prepare('SELECT COUNT(*) AS n FROM mod_warns WHERE guild_id = ? AND user_id = ?').get(guild, user) as { n: number }).n;

export const moderationSettings = () => ({
  enabled: getSetting('clear_enabled') !== '0',
  /** /ban, /unban, /kick and /warn */
  punish: getSetting('punish_enabled') !== '0',
  logChannelId: /^\d{15,25}$/.test(getSetting('clear_log_channel') ?? '') ? (getSetting('clear_log_channel') as string) : '',
  protectedChannels: parseIds(getSetting('clear_protected')),
  cooldown: cleanCooldown(getSetting('clear_cooldown')),
});

export function registerModeration({ app, admin, internal }: { app: Express; admin: RequestHandler; internal: RequestHandler }): void {
  const payload = () => ({
    ...moderationSettings(),
    maxProtected: MAX_PROTECTED,
    maxCooldown: MAX_COOLDOWN,
    channels: bot.guilds.flatMap((g) => g.channels.map((c) => ({ id: c.id, name: c.name, guild: g.name }))),
  });
  app.get('/api/settings/moderation', admin, (_req, res) => res.json(payload()));
  app.put('/api/settings/moderation', admin, (req, res) => {
    const b = z
      .object({
        enabled: z.boolean().optional(),
        punish: z.boolean().optional(),
        logChannelId: z.string().regex(/^(\d{15,25})?$/).optional(),
        protectedChannels: z.array(z.string().regex(/^\d{15,25}$/)).max(MAX_PROTECTED).optional(),
        cooldown: z.number().int().min(0).max(MAX_COOLDOWN).optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Модерация: проверьте канал и паузу (0–1440 минут)' });
    if (b.data.enabled !== undefined) setSetting('clear_enabled', b.data.enabled ? '1' : '0');
    if (b.data.punish !== undefined) setSetting('punish_enabled', b.data.punish ? '1' : '0');
    if (b.data.logChannelId !== undefined) setSetting('clear_log_channel', b.data.logChannelId);
    if (b.data.protectedChannels !== undefined) setSetting('clear_protected', JSON.stringify(cleanIds(b.data.protectedChannels)));
    if (b.data.cooldown !== undefined) setSetting('clear_cooldown', String(b.data.cooldown));
    res.json(payload());
  });
  app.get('/internal/moderation', internal, (_req, res) => res.json(moderationSettings()));
  app.post('/internal/warns', internal, (req, res) => {
    const b = z.object({ guildId: z.string().regex(/^\d{15,25}$/), userId: z.string().regex(/^\d{15,25}$/), modId: z.string().regex(/^\d{15,25}$/), reason: z.string().trim().min(1).max(400) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad warning' });
    const recent = recentWarns(b.data.guildId, b.data.userId);
    const r = db.prepare('INSERT INTO mod_warns (guild_id, user_id, mod_id, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(b.data.guildId, b.data.userId, b.data.modId, b.data.reason, Date.now());
    res.json({ id: Number(r.lastInsertRowid), total: totalWarns(b.data.guildId, b.data.userId), recent });
  });
  app.get('/internal/warns', internal, (req, res) => {
    const guild = String(req.query.guild ?? '');
    const user = String(req.query.user ?? '');
    if (!/^\d{15,25}$/.test(guild) || !/^\d{15,25}$/.test(user)) return res.status(400).json({ error: 'bad id' });
    res.json({ total: totalWarns(guild, user), recent: recentWarns(guild, user, 10) });
  });
}
