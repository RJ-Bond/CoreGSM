/**
 * Appeals of the banned: the private message of a ban has a button; it opens a window for the text; the appeal goes to the
 * appeals channel of the panel (or the log channel) with the buttons «Accept» (the ban is lifted) and «Decline». A person may
 * send one appeal in twelve hours, and only while the ban lasts.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import { humanDiscordError } from './errors.js';
import { log } from './log.js';
import { APPEAL_PAUSE_MS, appealDecideId, appealSendId, auditReason, parseAppeal } from './punishLogic.js';
import { EPHEMERAL, person, recordCase, sendDm, settings } from './punishKit.js';
import { COLORS } from './replies.js';
import { footerOf, getStyle } from './style.js';

const lastAppeal = new Map<string, number>();

const appealModal = (guildId: string) =>
  new ModalBuilder()
    .setCustomId(appealSendId(guildId))
    .setTitle('📨 Апелляция на блокировку')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('text').setLabel('Почему блокировку стоит снять?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(10).setMaxLength(1000),
      ),
    );

export async function handleAppealButton(i: ButtonInteraction): Promise<void> {
  const p = parseAppeal(i.customId);
  if (!p) return;
  try {
    if (p.kind === 'go') {
      await i.showModal(appealModal(p.guildId));
      return;
    }
    if (p.kind !== 'ok' && p.kind !== 'no') return;
    if (!i.guild || !i.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await i.reply({ content: 'Решать по апелляциям могут только администраторы сервера.', flags: EPHEMERAL });
      return;
    }
    await i.deferUpdate();
    const ok = p.kind === 'ok';
    const user = await i.client.users.fetch(p.userId);
    let note = '';
    if (ok) {
      try {
        await i.guild.members.unban(p.userId, auditReason(i.user.username, 'апелляция принята'));
        await recordCase({ guildId: i.guild.id, userId: user.id, userName: user.username, modId: i.user.id, modName: i.user.username, kind: 'unban', reason: 'апелляция принята' });
      } catch (e) {
        note = (e as { code?: number }).code === 10026 ? 'Блокировки уже нет.' : `Не удалось снять блокировку: ${humanDiscordError(e)}`;
      }
      if (!note) await sendDm(i.guild, user, 'unban', 'Апелляция принята');
    } else {
      const icon = i.guild.iconURL({ size: 128 });
      await user
        .send({ embeds: [new EmbedBuilder().setColor(COLORS.bad).setTitle('📨 Апелляция отклонена').setDescription(`Администрация сервера **${i.guild.name}** рассмотрела апелляцию и оставила блокировку.`).setFooter({ text: i.guild.name, ...(icon ? { iconURL: icon } : {}) })] })
        .catch(() => undefined);
    }
    const base = i.message.embeds[0];
    const e = (base ? EmbedBuilder.from(base) : new EmbedBuilder().setTitle('📨 Апелляция'))
      .setColor(note ? COLORS.warn : ok ? COLORS.ok : COLORS.bad)
      .setFooter(footerOf(`${ok ? 'Принято' : 'Отклонено'}: ${i.user.username}`));
    if (note) e.addFields({ name: 'Примечание', value: note.slice(0, 500) });
    await i.editReply({ embeds: [e], components: [] });
  } catch (e) {
    log('appeal button failed:', (e as Error).message);
    await i.followUp({ content: `Не получилось: ${humanDiscordError(e)}`, flags: EPHEMERAL }).catch(() => undefined);
  }
}

export async function handleAppealModal(i: ModalSubmitInteraction): Promise<void> {
  const p = parseAppeal(i.customId);
  if (!p || p.kind !== 'send') return;
  try {
    await i.deferReply();
    const key = `${p.guildId}:${i.user.id}`;
    const last = lastAppeal.get(key);
    if (last && Date.now() - last < APPEAL_PAUSE_MS) {
      await i.editReply('Вы уже отправляли апелляцию. Следующую можно подать через несколько часов.');
      return;
    }
    const guild = await i.client.guilds.fetch(p.guildId).catch(() => null);
    const ban = guild ? await guild.bans.fetch(i.user.id).catch(() => null) : null;
    if (!guild || !ban) {
      await i.editReply('Не нашёл вашей блокировки на этом сервере: возможно, она уже снята.');
      return;
    }
    const mod = await settings();
    const channelId = mod?.appealChannelId || mod?.logChannelId || '';
    const target = channelId ? ((await i.client.channels.fetch(channelId).catch(() => null)) as unknown as { send?: (o: unknown) => Promise<unknown> } | null) : null;
    if (!target?.send) {
      await i.editReply('Этот сервер сейчас не принимает апелляции. Свяжитесь с администрацией другим способом.');
      return;
    }
    const text = i.fields.getTextInputValue('text').trim().slice(0, 1000);
    const e = new EmbedBuilder()
      .setColor(getStyle().accent)
      .setTitle('📨 Апелляция на блокировку')
      .setThumbnail(i.user.displayAvatarURL({ size: 128 }))
      .addFields({ name: '👤 Участник', value: person(i.user), inline: true }, { name: '🔨 Причина блокировки', value: (ban.reason || 'не указана').slice(0, 500) }, { name: '✍️ Что написал участник', value: text })
      .setTimestamp(new Date())
      .setFooter(footerOf('Апелляция'));
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(appealDecideId(true, guild.id, i.user.id)).setLabel('Принять и разбанить').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(appealDecideId(false, guild.id, i.user.id)).setLabel('Отклонить').setEmoji('✖️').setStyle(ButtonStyle.Danger),
    );
    await target.send({ embeds: [e], components: [row], allowedMentions: { parse: [] } });
    await recordCase({ guildId: guild.id, userId: i.user.id, userName: i.user.username, modId: i.user.id, modName: i.user.username, kind: 'appeal', reason: text.slice(0, 400) });
    lastAppeal.set(key, Date.now());
    if (lastAppeal.size > 500) lastAppeal.clear();
    await i.editReply('✅ Апелляция отправлена администрации. Решение придёт вам в личные сообщения.');
  } catch (e) {
    log('appeal failed:', (e as Error).message);
    await i.editReply('Не получилось отправить апелляцию. Попробуйте позже.').catch(() => undefined);
  }
}
