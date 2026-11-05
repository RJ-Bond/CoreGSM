/** «🔔 Следить» under a server card or a player card: subscribes the person (found by Discord id) to alerts in private messages. */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ButtonInteraction } from 'discord.js';
import { backendJson } from './backend.js';
import { followId, followText, parseFollow, type FollowAnswer } from './followLogic.js';
import { log } from './log.js';
import { COLORS, replyEmbed } from './replies.js';

const EPHEMERAL = 64;

export const followButton = (kind: 'server' | 'player', key: string | number, label = '🔔 Следить'): ButtonBuilder =>
  new ButtonBuilder().setCustomId(followId(kind, key, true)).setLabel(label).setStyle(ButtonStyle.Secondary);

export async function handleFollow(i: ButtonInteraction): Promise<void> {
  const f = parseFollow(i.customId);
  if (!f) return;
  try {
    await i.deferReply({ flags: EPHEMERAL });
  } catch (e) {
    log(`follow from ${i.user.id}: could not acknowledge:`, (e as Error).message);
    return;
  }
  try {
    const r = await backendJson<FollowAnswer>('/internal/discord/follow', {
      method: 'POST',
      body: JSON.stringify({ discordId: i.user.id, kind: f.kind, ...(f.kind === 'server' ? { serverId: f.id } : { nick: f.nick }), on: f.on }),
    });
    if (!r.data) {
      await i.editReply(replyEmbed('Не получилось', 'Панель сейчас не отвечает. Попробуйте чуть позже.', COLORS.bad));
      return;
    }
    const t = followText(r.data, f);
    const out = replyEmbed(t.title, t.text, t.ok ? COLORS.ok : COLORS.warn);
    // the opposite button: the person can change their mind at once
    const back = t.ok ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(followId(f.kind, f.kind === 'server' ? f.id : f.nick, !f.on)).setLabel(f.on ? '🔕 Отписаться' : '🔔 Следить снова').setStyle(ButtonStyle.Secondary))] : [];
    await i.editReply({ ...out, components: back });
  } catch (e) {
    log('follow failed:', (e as Error).message);
    await i.editReply(replyEmbed('Не получилось', 'Панель сейчас не отвечает. Попробуйте чуть позже.', COLORS.bad)).catch(() => undefined);
  }
}
