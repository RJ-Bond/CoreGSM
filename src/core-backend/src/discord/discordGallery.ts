/**
 * The look of the bot's messages:
 *   GET|PUT /api/settings/discord-style   { accent, logo, footer }  (admin)
 *   GET     /api/admin/discord-gallery    every kind of message with sample data, built by the real builders (admin)
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { downEmbed, testEmbed, upEmbed } from '../alerts/alerts.js';
import { diskEmbed } from '../alerts/attention.js';
import { setSetting } from '../db.js';
import { buildEmbed, type EmbedServer } from '../images/embed.js';
import { applyLayout, type EmbedLayout } from '../images/embedLayout.js';
import { currentStyle, styleSettings } from './discordStyleState.js';
import { styleAlertEmbed } from './discordStyleLogic.js';
import { pollEmbed } from '../community/polls.js';
import { buildNotice } from '../admin/updateLogic.js';
import { renderWelcome } from '../community/welcomeLogic.js';
import { tally } from '../community/communityPollLogic.js';
import { brand, publicBase } from '../admin/site.js';
import { giveawayEmbed, giveawayResultEmbed } from '../community/giveaways.js';
import { verifyEmbed } from '../community/verify.js';
import { digestCard, digestLine, followCard, newDeviceCard, newsCard, seenCard, serverCard, weeklyCard, type Ctx, type DmCard } from '../alerts/dmCard.js';

interface Sample { id: string; group: 'servers' | 'alerts' | 'community' | 'private' | 'updates'; title: string; content?: string; embed: Record<string, unknown>; buttons?: string[] }

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

  out.push({ id: 'giveaway-new', group: 'community', title: 'Розыгрыш: идёт', embed: styled('poll', giveawayEmbed({ id: 3, prize: 'Скин «Тёмный рыцарь»', winners: 2, ends_at: now + 86_400_000, role_id: '', min_hours: 10 }, 17)), buttons: ['🎉 Участвую'] });
  out.push({ id: 'giveaway-result', group: 'community', title: 'Розыгрыш: итоги', content: '<@123456789012345678>', embed: styled('poll', giveawayResultEmbed('Скин «Тёмный рыцарь»', ['123456789012345678', '234567890123456789'])) });
  out.push({ id: 'verify', group: 'community', title: 'Принятие правил', embed: styled('poll', verifyEmbed('', '1. Уважайте других игроков.\n2. Без рекламы и спама.\n3. Решения модераторов не обсуждаются в чате.')), buttons: ['✅ Принимаю правила'] });

  // private cards (DM): the same builders the delivery uses
  const ctx: Ctx = { lang: 'ru', base: base ?? '', brand: st.footer, ...(st.logoUrl ? { logoUrl: st.logoUrl } : {}) };
  const dm = (id: string, title: string, c: DmCard) => out.push({ id: `dm-${id}`, group: 'private', title, embed: c.embed as unknown as Record<string, unknown>, buttons: [...c.buttons.map((b) => b.label), ...c.actions.map((a) => a.label)] });
  dm('server', 'Сервер: событие', serverCard(ctx, { serverId: 1, name: 'Мой сервер', address: 'play.example.com:27015', events: [{ kind: 'free_slot', ts: now, players: 31, max: 32 }] }));
  dm('server-many', 'Сервер: несколько событий', serverCard(ctx, { serverId: 1, name: 'Мой сервер', address: 'play.example.com:27015', events: [{ kind: 'went_down', ts: now - 600_000, players: 0, max: 32 }, { kind: 'back_online', ts: now, players: 3, max: 32 }] }));
  dm('device', 'Вход с нового устройства', newDeviceCard(ctx, { device: 'Chrome на Windows', ts: now }));
  dm('seen', 'Игрок на сервере', seenCard(ctx, { server: 'Мой сервер', nick: 'Alex', ts: now, rank: 'Ветеран' }));
  dm('follow', 'Слежение за игроком', followCard(ctx, { nick: 'Alex', server: 'Мой сервер', address: 'play.example.com:27015', serverId: 1, ts: now }));
  dm('news', 'Новость', newsCard(ctx, { title: 'Вайп в субботу', category: 'Новости', text: 'Сервер перезапустится в 12:00 по Москве.', url: base ? `${base}/news/1` : 'https://example.com', ts: now }));
  dm('digest', 'Сводка за тихие часы', digestCard(ctx, { lines: [digestLine('🔴 Мой сервер недоступен', now - 3_600_000), digestLine('✅ Мой сервер снова в сети', now - 3_000_000)], since: now - 28_800_000 }));
  dm('weekly', 'Итоги недели (администраторам)', weeklyCard(ctx, { from: now - 7 * 86_400_000, to: now, peak: 28, peakPrev: 22, peakAt: now - 86_400_000, newPlayers: 14, activePlayers: 63, newAccounts: 9, warns: 5, bans: 1, kicks: 2, mutes: 3, reports: 4 }));

  const n = buildNotice({ kind: 'available', mode: 'brief', lang: 'ru', links: { to: base ? `${base}/` : 'https://example.com/releases', more: null }, from: '1.0.0.20', to: '1.0.0.27', line: 'Доступна новая версия панели.', now, releases: [{ version: '1.0.0.27', date: '26.10.2026', groups: [{ title: 'Новое', titleEn: 'New', items: [{ text: 'Заметки о выпуске в сообщении', textEn: 'Release notes in the message', flags: [] }] }, { title: '🐛 Исправлено', titleEn: '🐛 Fixed', items: [{ text: 'Мелкая правка', textEn: 'A small fix', flags: [] }, { text: 'Ещё одна правка', textEn: 'Another fix', flags: [] }] }] }] });
  out.push({ id: 'update', group: 'updates', title: 'Доступно обновление панели', embed: styled('update', { title: n.title, description: n.description, color: n.color, ...(n.fields.length ? { fields: n.fields } : {}), ...(n.footer ? { footer: { text: n.footer } } : {}) }), buttons: (n.actions ?? []).map((a) => a.label) });
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
