/**
 * Settings of the moderation commands of the bot (/clear):
 *   GET|PUT /api/settings/moderation   { enabled, logChannelId, protectedChannels, cooldown }   (admin)
 *   GET /internal/moderation   the same for the bot, read at each command
 * `protectedChannels` are never cleaned; `logChannelId` receives a record of each cleaning; `cooldown` is the pause in
 * minutes between two cleanings of one channel.
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { getSetting, setSetting } from '../db.js';
import { bot } from '../discord/botState.js';
import { MAX_COOLDOWN, MAX_PROTECTED, cleanCooldown, cleanIds, parseIds } from './moderationLogic.js';

export const moderationSettings = () => ({
  enabled: getSetting('clear_enabled') !== '0',
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
        logChannelId: z.string().regex(/^(\d{15,25})?$/).optional(),
        protectedChannels: z.array(z.string().regex(/^\d{15,25}$/)).max(MAX_PROTECTED).optional(),
        cooldown: z.number().int().min(0).max(MAX_COOLDOWN).optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Модерация: проверьте канал и паузу (0–1440 минут)' });
    if (b.data.enabled !== undefined) setSetting('clear_enabled', b.data.enabled ? '1' : '0');
    if (b.data.logChannelId !== undefined) setSetting('clear_log_channel', b.data.logChannelId);
    if (b.data.protectedChannels !== undefined) setSetting('clear_protected', JSON.stringify(cleanIds(b.data.protectedChannels)));
    if (b.data.cooldown !== undefined) setSetting('clear_cooldown', String(b.data.cooldown));
    res.json(payload());
  });
  app.get('/internal/moderation', internal, (_req, res) => res.json(moderationSettings()));
}
