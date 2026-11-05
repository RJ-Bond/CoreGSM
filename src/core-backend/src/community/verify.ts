/**
 * «Accept the rules» card: the administrator picks a channel, a role and a text; the card gets a button and a member who
 * presses it receives the role (the bot does it: the role id is in the button, so nothing is stored).
 *   POST /api/discord/verify-card   (admin) { channelId, roleId, title?, text }
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { enqueueAlert } from '../alerts/alerts.js';
import { COLORS } from '../discord/palette.js';

/** the card with the rules and the button: also used by the message gallery in the admin */
export const verifyEmbed = (title: string, text: string) => ({ title: title || '📜 Правила сообщества', description: `${text}\n\n👇 Нажимая кнопку, вы принимаете правила и получаете доступ к каналам.`, color: COLORS.info });

export function registerVerify({ app, admin }: { app: Express; admin: RequestHandler }): void {
  app.post('/api/discord/verify-card', admin, (req, res) => {
    const b = z.object({ channelId: z.string().regex(/^\d{15,25}$/), roleId: z.string().regex(/^\d{15,25}$/), title: z.string().trim().max(100).optional(), text: z.string().trim().min(3).max(1500) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Нужны канал, ID роли и текст правил (от 3 символов)' });
    enqueueAlert('poll', 'CoreGSM', {
      content: '',
      mention: 'none',
      embed: verifyEmbed(b.data.title ?? '', b.data.text),
      buttons: [{ customId: `vfy:${b.data.roleId}`, label: '✅ Принимаю правила' }],
    }, b.data.channelId);
    res.json({ ok: true });
  });
}
