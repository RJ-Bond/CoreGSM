/**
 * Welcome message for new members of the Discord server:
 *   GET|PUT /api/settings/welcome   { enabled, channelId, text, embed, roles }   (admin)
 *   GET /internal/welcome?user=&server=&count=   the ready message for the bot, 404 while the feature is off
 *   GET /internal/roles/options   the roles a member may take by himself (the menu under the greeting and /roles)
 * The bot needs the privileged «Server Members» intent only while the feature is on.
 *
 * `text` may hold several greetings separated by a line with «---»: one of them is picked at random. Empty text means the
 * funny defaults (welcomeLogic.ts). `embed` is the beautiful look (avatar, colour, member number); `roles` are the roles
 * a member can pick from a menu (at most 25, a Discord limit).
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { getSetting, setSetting } from '../db.js';
import { bot, channelInfo } from '../discord/botState.js';
import { DEFAULT_WELCOME, MAX_WELCOME, renderWelcomePick } from './welcomeLogic.js';

export const MAX_PICK_ROLES = 25;

export const welcomeSettings = () => ({
  enabled: getSetting('welcome_enabled') === '1' && /^\d{15,25}$/.test(getSetting('welcome_channel') ?? ''),
  channelId: getSetting('welcome_channel') ?? '',
  text: getSetting('welcome_text') ?? '',
  /** the beautiful look is on unless it was switched off */
  embed: getSetting('welcome_embed') !== '0',
});

/** the role ids chosen in the panel (only well-formed ids, no duplicates) */
export function pickRoleIds(): string[] {
  try {
    const v = JSON.parse(getSetting('welcome_roles') ?? '[]') as unknown;
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && /^\d{15,25}$/.test(x)))].slice(0, MAX_PICK_ROLES) : [];
  } catch {
    return [];
  }
}

/** the roles of the Discord server of the welcome channel that the bot may hand out (the bot decides what is safe) */
export function availableRoles(channelId: string): { id: string; name: string; color: number }[] {
  const guildId = channelInfo(channelId).guildId;
  const g = bot.guilds.find((x) => x.id === guildId);
  return (g?.roles ?? []).filter((r) => r.pick !== false).map(({ id, name, color }) => ({ id, name, color }));
}

/** the last greeting that was used: the next one is a different one */
let lastIndex = -1;

export function registerWelcome({ app, admin, internal }: { app: Express; admin: RequestHandler; internal: RequestHandler }): void {
  const payload = () => {
    const s = welcomeSettings();
    return {
      enabled: getSetting('welcome_enabled') === '1',
      channelId: s.channelId,
      text: s.text,
      embed: s.embed,
      roles: pickRoleIds(),
      availableRoles: availableRoles(s.channelId),
      defaultText: DEFAULT_WELCOME,
      maxLength: MAX_WELCOME,
      maxRoles: MAX_PICK_ROLES,
    };
  };
  app.get('/api/settings/welcome', admin, (_req, res) => res.json(payload()));
  app.put('/api/settings/welcome', admin, (req, res) => {
    const b = z
      .object({
        enabled: z.boolean().optional(),
        channelId: z.string().regex(/^(\d{15,25})?$/).optional(),
        text: z.string().max(MAX_WELCOME).optional(),
        embed: z.boolean().optional(),
        roles: z.array(z.string().regex(/^\d{15,25}$/)).max(MAX_PICK_ROLES).optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Приветствие: проверьте канал и длину текста (до 1000 символов)' });
    if (b.data.channelId !== undefined) setSetting('welcome_channel', b.data.channelId);
    if (b.data.text !== undefined) setSetting('welcome_text', b.data.text.trim());
    if (b.data.enabled !== undefined) setSetting('welcome_enabled', b.data.enabled ? '1' : '0');
    if (b.data.embed !== undefined) setSetting('welcome_embed', b.data.embed ? '1' : '0');
    if (b.data.roles !== undefined) setSetting('welcome_roles', JSON.stringify([...new Set(b.data.roles)]));
    res.json(payload());
  });
  app.get('/internal/welcome', internal, (req, res) => {
    const s = welcomeSettings();
    if (!s.enabled) return res.status(404).json({ error: 'off' });
    const count = Number(req.query.count);
    const r = renderWelcomePick(s.text, { userId: String(req.query.user ?? ''), server: String(req.query.server ?? ''), count: Number.isInteger(count) ? count : null }, Math.random, lastIndex, s.embed);
    lastIndex = r.index;
    res.json({ channelId: s.channelId, content: r.content, embed: s.embed, funny: r.funny, roles: pickRoleIds() });
  });
  // the menu does not depend on the greeting being on: /roles works on its own
  app.get('/internal/roles/options', internal, (_req, res) => res.json({ roles: pickRoleIds() }));
}
