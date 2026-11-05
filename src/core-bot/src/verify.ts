/** The «✅ Принимаю правила» button: gives the member the role written in the button («vfy:<role id>»). */
import type { ButtonInteraction } from 'discord.js';
import { log } from './log.js';
import { COLORS, replyEmbed } from './replies.js';

const EPHEMERAL = 64;

export async function handleVerify(i: ButtonInteraction): Promise<void> {
  const m = /^vfy:(\d{15,25})$/.exec(i.customId);
  if (!m || !i.inGuild()) return;
  try {
    await i.deferReply({ flags: EPHEMERAL });
  } catch (e) {
    log('verify: could not acknowledge:', (e as Error).message);
    return;
  }
  const member = await i.guild?.members.fetch(i.user.id).catch(() => null);
  if (!member) {
    await i.editReply(replyEmbed('Не получилось', 'Не удалось найти вас на сервере, попробуйте ещё раз.', COLORS.bad)).catch(() => undefined);
    return;
  }
  if (member.roles.cache.has(m[1]!)) {
    await i.editReply(replyEmbed('Вы уже в сообществе', 'Роль уже выдана, дополнительно ничего делать не нужно.', COLORS.ok)).catch(() => undefined);
    return;
  }
  try {
    await member.roles.add(m[1]!, 'Принял правила (кнопка в панели CoreGSM)');
    await i.editReply(replyEmbed('Добро пожаловать!', 'Правила приняты, роль выдана: каналы открыты. Привязать игровой ник — команда /link.', COLORS.ok)).catch(() => undefined);
  } catch (e) {
    log('verify: could not give the role:', (e as Error).message);
    await i.editReply(replyEmbed('Не получилось выдать роль', 'У бота нет права «Управлять ролями» или его роль ниже выдаваемой. Сообщите администратору.', COLORS.bad)).catch(() => undefined);
  }
}
