/**
 * The look of the bot's messages:
 *   GET|PUT /api/settings/discord-style   { accent, logo, footer }  (admin)
 *   GET     /api/admin/discord-gallery    every kind of message with sample data, built by the real builders (admin)
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { downEmbed, testEmbed, upEmbed } from './alerts.js';
import { diskEmbed } from './attention.js';
import { setSetting } from './db.js';
import { buildEmbed, type EmbedServer } from './embed.js';
import { applyLayout, type EmbedLayout } from './embedLayout.js';
import { currentStyle, styleSettings } from './discordStyleState.js';
import { styleAlertEmbed } from './discordStyleLogic.js';
import { pollEmbed } from './polls.js';
import { buildNotice } from './updateLogic.js';
import { renderWelcome } from './welcomeLogic.js';
import { tally } from './communityPollLogic.js';
import { brand, publicBase } from './site.js';

interface Sample { id: string; group: 'servers' | 'alerts' | 'community' | 'updates'; title: string; content?: string; embed: Record<string, unknown>; buttons?: string[] }

export function buildGallery(now = Date.now()): Sample[] {
  const st = currentStyle();
  const ss = styleSettings();
  const base = publicBase();
  const styled = (kind: string, e: Record<string, unknown>) => styleAlertEmbed(e, kind, st) as Record<string, unknown>;
  const online: EmbedServer = { name: 'Мой сервер', game: 'counterstrike2', address: 'play.example.com:27015', hasStatus: true, online: true, players: 12, maxPlayers: 32, map: 'de_dust2', version: '1.40', ping: 34, playerNames: ['Alex', 'Bob', 'Cat', 'Dan', 'Eve', 'Fox'], error: null, updatedAt: now };
  const offline: EmbedServer = { ...online, online: false, players: 0, map: null, ping: null, playerNames: [], error: 'Нет ответа' };
  const extra = { serverId: 1, playersShown: 5, baseUrl: base, brandName: st.footer, showLogo: ss.logo, lastOnlineAt: now - 3_600_000, version: 'v1.0' };
  const layouts: [EmbedLayout, string][] = [['detailed', 'Подробный'], ['compact', 'Компактный'], ['minimal', 'Минимальный']];
  const out: Sample[] = [];
  for (const [l, label] of layouts) out.push({ id: `server-${l}`, group: 'servers', title: `Сервер онлайн · ${label}`, embed: applyLayout(buildEmbed(online, 99.2, 60, extra), l) as unknown as Record<string, unknown>, buttons: ['👥 Все игроки на сайте'] });
  out.push({ id: 'server-offline', group: 'servers', title: 'Сервер недоступен', embed: buildEmbed(offline, 97, 60, extra) as unknown as Record<string, unknown> });

  const alert = { name: 'Мой сервер', address: 'play.example.com:27015', game: 'counterstrike2', downMs: 12 * 60_000, now };
  out.push({ id: 'alert-down', group: 'alerts', title: 'Сервер не отвечает', content: '@here', embed: styled('down', downEmbed({ ...alert, error: 'Нет ответа' })) });
  out.push({ id: 'alert-up', group: 'alerts', title: 'Сервер снова в сети', embed: styled('up', upEmbed(alert)) });
  out.push({ id: 'alert-test', group: 'alerts', title: 'Проверка оповещений', embed: styled('test', testEmbed()) });
  out.push({ id: 'alert-disk-warn', group: 'alerts', title: 'Мало места на диске', embed: styled('disk', diskEmbed('warn', 12 * 1024 ** 3, 100 * 1024 ** 3)) });
  out.push({ id: 'alert-disk-bad', group: 'alerts', title: 'Заканчивается место', content: '@here', embed: styled('disk', diskEmbed('bad', 3 * 1024 ** 3, 100 * 1024 ** 3)) });

  const t = tally([{ id: 1, text: 'Да' }, { id: 2, text: 'Нет' }, { id: 3, text: 'Не важно' }], new Map([[1, 7], [2, 2], [3, 1]]));
  out.push({ id: 'poll-new', group: 'community', title: 'Новое голосование', embed: styled('poll', pollEmbed({ question: 'Нужна новая карта?', closesAt: now + 86_400_000, rows: t.rows, total: t.total, isNew: true, site: !!base })), buttons: t.rows.map((r) => r.text) });
  out.push({ id: 'poll-result', group: 'community', title: 'Итоги голосования', embed: styled('poll', pollEmbed({ question: 'Нужна новая карта?', closesAt: null, rows: t.rows, total: t.total, isNew: false, site: !!base })) });
  out.push({ id: 'welcome', group: 'community', title: 'Приветствие новичка', content: renderWelcome('', { userId: '123456789012345678', server: brand().name }), embed: {} });

  const n = buildNotice({ kind: 'available', lang: 'ru', from: '1.0.0.20', to: '1.0.0.27', line: 'Доступна новая версия панели.', now, releases: [{ version: '1.0.0.27', date: '26.10.2026', groups: [{ title: 'Новое', titleEn: 'New', items: [{ text: 'Заметки о выпуске в сообщении', textEn: 'Release notes in the message', flags: [] }] }] }] });
  out.push({ id: 'update', group: 'updates', title: 'Доступно обновление панели', embed: styled('update', { title: n.title, description: n.description, color: n.color, ...(n.fields.length ? { fields: n.fields } : {}), ...(n.footer ? { footer: { text: n.footer } } : {}) }) });
  return out;
}

export function registerDiscordGallery({ app, admin }: { app: Express; admin: RequestHandler }): void {
  const payload = () => ({ ...styleSettings(), brandAccent: brand().color });
  app.get('/api/settings/discord-style', admin, (_req, res) => res.json(payload()));
  app.put('/api/settings/discord-style', admin, (req, res) => {
    const b = z.object({ accent: z.string().regex(/^(#[0-9a-fA-F]{6})?$/).optional(), logo: z.boolean().optional(), footer: z.string().max(40).optional() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Стиль сообщений: цвет вида #5a4bd1, подпись до 40 символов' });
    if (b.data.accent !== undefined) setSetting('discord_accent', b.data.accent);
    if (b.data.logo !== undefined) setSetting('discord_logo', b.data.logo ? '1' : '0');
    if (b.data.footer !== undefined) setSetting('discord_footer', b.data.footer.trim());
    res.json(payload());
  });
  app.get('/api/admin/discord-gallery', admin, (_req, res) => res.json({ items: buildGallery() }));
}
