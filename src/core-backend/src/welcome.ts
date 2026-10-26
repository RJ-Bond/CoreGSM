/**
 * Welcome message for new members of the Discord server:
 *   GET|PUT /api/settings/welcome   { enabled, channelId, text }   (admin)
 *   GET /internal/welcome?user=&server=   the ready message for the bot, 404 while the feature is off
 * The bot needs the privileged «Server Members» intent only while the feature is on.
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { getSetting, setSetting } from './db.js';
import { DEFAULT_WELCOME, MAX_WELCOME, renderWelcome } from './welcomeLogic.js';

export const welcomeSettings = () => ({
  enabled: getSetting('welcome_enabled') === '1' && /^\d{15,25}$/.test(getSetting('welcome_channel') ?? ''),
  channelId: getSetting('welcome_channel') ?? '',
  text: getSetting('welcome_text') ?? '',
});

export function registerWelcome({ app, admin, internal }: { app: Express; admin: RequestHandler; internal: RequestHandler }): void {
  const payload = () => {
    const s = welcomeSettings();
    return { enabled: getSetting('welcome_enabled') === '1', channelId: s.channelId, text: s.text, defaultText: DEFAULT_WELCOME, maxLength: MAX_WELCOME };
  };
  app.get('/api/settings/welcome', admin, (_req, res) => res.json(payload()));
  app.put('/api/settings/welcome', admin, (req, res) => {
    const b = z
      .object({ enabled: z.boolean().optional(), channelId: z.string().regex(/^(\d{15,25})?$/).optional(), text: z.string().max(MAX_WELCOME).optional() })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Приветствие: проверьте канал и длину текста (до 1000 символов)' });
    if (b.data.channelId !== undefined) setSetting('welcome_channel', b.data.channelId);
    if (b.data.text !== undefined) setSetting('welcome_text', b.data.text.trim());
    if (b.data.enabled !== undefined) setSetting('welcome_enabled', b.data.enabled ? '1' : '0');
    res.json(payload());
  });
  app.get('/internal/welcome', internal, (req, res) => {
    const s = welcomeSettings();
    if (!s.enabled) return res.status(404).json({ error: 'off' });
    res.json({ channelId: s.channelId, content: renderWelcome(s.text, { userId: String(req.query.user ?? ''), server: String(req.query.server ?? '') }) });
  });
}
