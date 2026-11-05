/** Keeps the live dashboard message up to date: the panel says where it lives, the bot edits it (or posts it once). */
import { type Client, EmbedBuilder } from 'discord.js';
import { backend, backendJson } from './backend.js';
import { DASH_INTERVAL_MS, dashboardEmbed, type DashOnline, type DashTop } from './dashboardLogic.js';
import { humanDiscordError } from './errors.js';
import { log } from './log.js';
import { getStyle } from './style.js';
import { panelRow } from './ui.js';

let last = 0;

const isGone = (e: unknown): boolean => (e as { code?: number })?.code === 10008;

async function report(body: { messageId?: string; error?: string | null }): Promise<void> {
  await backend('/internal/dashboard', { method: 'PATCH', body: JSON.stringify(body) }).catch(() => undefined);
}

export async function updateDashboard(c: Client, now = Date.now()): Promise<void> {
  if (now - last < DASH_INTERVAL_MS) return;
  last = now;
  const cfg = await backendJson<{ channelId: string; messageId: string | null }>('/internal/dashboard');
  if (!cfg.ok || !cfg.data) return; // 404 = switched off
  try {
    const [online, top] = await Promise.all([backendJson<DashOnline>('/internal/discord/online'), backendJson<DashTop>('/internal/discord/top?period=week')]);
    if (!online.data) return;
    const st = getStyle();
    const embed = new EmbedBuilder(dashboardEmbed(online.data, top.data, st, now));
    const components = panelRow([{ label: '🌐 Открыть панель', url: online.data.url }, { label: '🏆 Сообщество', path: '/community' }]);
    const channel = await c.channels.fetch(cfg.data.channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) throw Object.assign(new Error('Канал не найден или не текстовый'), { code: 10003 });
    if (cfg.data.messageId) {
      try {
        const msg = await channel.messages.fetch(cfg.data.messageId);
        await msg.edit({ embeds: [embed], components });
        if (cfg.data.messageId) await report({ error: null });
        return;
      } catch (e) {
        if (!isGone(e)) throw e;
        log('dashboard: the message was deleted, posting a new one');
      }
    }
    const sent = await channel.send({ embeds: [embed], components });
    await report({ messageId: sent.id, error: null });
  } catch (e) {
    log('dashboard failed:', (e as Error).message);
    await report({ error: humanDiscordError(e) });
  }
}
