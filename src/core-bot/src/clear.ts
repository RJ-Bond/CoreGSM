/**
 * /clear: wipes the chat of the channel where it was typed. Only for those who may manage messages, always with a
 * confirmation (the buttons live two minutes and answer only to the person who typed the command). While it works the
 * private message shows the progress with a «Stop» button; when it is done the channel gets a short notice that removes itself.
 *
 * Discord deletes messages in bulk only while they are younger than 14 days: older ones stay, and the result says how many.
 * Pinned messages are never deleted.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { CONFIRM_TTL_MS, MAX_COUNT, MAX_RUN_MS, clearId, durationText, isExpired, messages, normalizeCount, parseClearId, sortPage, stopId } from './clearLogic.js';
import { humanDiscordError } from './errors.js';
import { log } from './log.js';
import { COLORS, bar10, replyEmbed } from './replies.js';
import { footerOf, getStyle } from './style.js';

export const CLEAR_COMMANDS = [
  {
    name: 'clear',
    description: 'Очистить чат в этом канале (для модераторов, с подтверждением)',
    dm_permission: false,
    default_member_permissions: String(PermissionFlagsBits.ManageMessages),
    options: [{ type: 4, name: 'count', description: `Сколько последних сообщений удалить (по умолчанию весь чат, не больше ${MAX_COUNT})`, min_value: 1, max_value: MAX_COUNT, required: false }],
  },
];
export const CLEAR_NAMES = new Set(CLEAR_COMMANDS.map((c) => c.name));

const EPHEMERAL = 64;
const NEED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages];

/** the part of a text channel that the run needs (kept small on purpose) */
interface Cleanable {
  id: string;
  messages: { fetch: (o: { limit: number; before?: string }) => Promise<Map<string, { id: string; createdTimestamp: number; pinned: boolean }>> };
  bulkDelete: (ids: string[], filterOld: boolean) => Promise<{ size: number }>;
  send?: (o: unknown) => Promise<{ delete: () => Promise<unknown> }>;
}

/** channels where a run is going now; `stop` is set by the «Stop» button */
const running = new Map<string, { stop: boolean }>();

const empty = () => ({ components: [] as never[] });

function confirmView(channelId: string, userId: string, count: number, now: number) {
  const e = new EmbedBuilder()
    .setColor(COLORS.warn)
    .setTitle('🧹 Очистить канал?')
    .setDescription(`${count ? `Будут удалены последние **${messages(count)}**` : 'Будет удалён **весь чат**'} в канале <#${channelId}>.\nПосле удаления вернуть сообщения нельзя.`)
    .addFields(
      { name: '📌 Закреплённые', value: 'останутся на месте', inline: true },
      { name: '⏳ Старше 14 дней', value: 'Discord не даёт удалить, останутся', inline: true },
      { name: '⏱️ Подтвердите', value: `в течение ${Math.round(CONFIRM_TTL_MS / 60_000)} мин`, inline: true },
    )
    .setFooter(footerOf('Очистка'));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(clearId('go', userId, count, now)).setLabel('Да, очистить').setEmoji('🧹').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(clearId('no', userId, count, now)).setLabel('Отмена').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [e], components: [row] };
}

function progressView(channelId: string, count: number, deleted: number, elapsed: number) {
  const e = new EmbedBuilder()
    .setColor(getStyle().accent)
    .setTitle('🧹 Очищаю канал…')
    .setDescription(count ? `${bar10(Math.min(1, deleted / count))} **${deleted}** из ${count}` : `Удалено: **${messages(deleted)}**`)
    .addFields({ name: 'Прошло', value: durationText(elapsed), inline: true })
    .setFooter(footerOf('Очистка'));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(stopId(channelId)).setLabel('Остановить').setEmoji('⏹️').setStyle(ButtonStyle.Secondary));
  return { embeds: [e], components: [row] };
}

interface Totals { deleted: number; pinned: number; old: number }

function doneEmbed(t: Totals, elapsed: number, stopped: boolean, count: number) {
  const e = new EmbedBuilder()
    .setColor(t.deleted ? COLORS.ok : getStyle().accent)
    .setTitle(t.deleted ? (stopped ? '⏹️ Остановлено' : '✨ Канал очищен') : 'Удалять было нечего')
    .setFooter(footerOf('Очистка'));
  if (t.deleted) e.setDescription(`Удалено: **${messages(t.deleted)}** за ${durationText(elapsed)}.${count && t.deleted < count && !stopped ? '\nВ канале больше нет сообщений, которые можно удалить.' : ''}`);
  else e.setDescription('В канале нет сообщений, которые можно удалить.');
  if (t.pinned) e.addFields({ name: '📌 Закреплённых оставлено', value: String(t.pinned), inline: true });
  if (t.old) e.addFields({ name: '⏳ Старше 14 дней', value: `${t.old}+ осталось: Discord не удаляет такие пачкой`, inline: true });
  return e;
}

const noPerm = (text: string) => ({ ...replyEmbed('Недостаточно прав', text, COLORS.bad), flags: EPHEMERAL });

export async function handleClearCommand(i: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!i.guild || !i.channel) {
      await i.reply({ ...replyEmbed('Только на сервере', 'Команда работает в канале Discord-сервера.', COLORS.warn), flags: EPHEMERAL });
      return;
    }
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await i.reply(noPerm('Очищать чат могут участники с правом «Управлять сообщениями».'));
      return;
    }
    if (i.appPermissions && !i.appPermissions.has(NEED)) {
      await i.reply(noPerm('Боту нужны в этом канале права «Просмотр канала», «Читать историю сообщений» и «Управлять сообщениями». Выдайте их роли бота или пригласите бота заново по ссылке из панели.'));
      return;
    }
    if (running.has(i.channel.id)) {
      await i.reply({ ...replyEmbed('Уже идёт', 'В этом канале очистка уже выполняется.', COLORS.warn), flags: EPHEMERAL });
      return;
    }
    const count = normalizeCount(i.options.getInteger('count'));
    await i.reply({ ...confirmView(i.channel.id, i.user.id, count, Date.now()), flags: EPHEMERAL });
  } catch (e) {
    log('/clear failed:', (e as Error).message);
    await i.reply({ ...replyEmbed('Не получилось', humanDiscordError(e), COLORS.bad), flags: EPHEMERAL }).catch(() => undefined);
  }
}

export async function handleClearButton(i: ButtonInteraction): Promise<void> {
  const p = parseClearId(i.customId);
  if (!p) return;
  try {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await i.reply(noPerm('Нужно право «Управлять сообщениями».'));
      return;
    }
    if (p.action === 'stop') {
      const r = running.get(String(p.userId));
      if (r) r.stop = true;
      await i.deferUpdate();
      return;
    }
    if (i.user.id !== p.userId) {
      await i.reply({ ...replyEmbed('Это не ваша очистка', 'Подтвердить может только тот, кто набрал команду. Наберите `/clear` сами.', COLORS.warn), flags: EPHEMERAL });
      return;
    }
    if (p.action === 'no') {
      await i.update({ ...replyEmbed('Отменено', 'Ничего не удалено.', COLORS.ok), ...empty() });
      return;
    }
    if (isExpired(p.at, Date.now())) {
      await i.update({ ...replyEmbed('Время вышло', 'Подтверждение устарело. Наберите `/clear` ещё раз.', COLORS.warn), ...empty() });
      return;
    }
    await run(i, p.count);
  } catch (e) {
    log('/clear button failed:', (e as Error).message);
    const out = { ...replyEmbed('Не получилось', humanDiscordError(e), COLORS.bad), ...empty() };
    await (i.deferred || i.replied ? i.editReply(out) : i.update(out)).catch(() => undefined);
  }
}

async function run(i: ButtonInteraction, count: number): Promise<void> {
  const ch = i.channel as unknown as Cleanable | null;
  if (!ch || typeof ch.bulkDelete !== 'function') {
    await i.update({ ...replyEmbed('Сюда нельзя', 'В этом канале очистка не поддерживается.', COLORS.bad), ...empty() });
    return;
  }
  if (running.has(ch.id)) {
    await i.update({ ...replyEmbed('Уже идёт', 'В этом канале очистка уже выполняется.', COLORS.warn), ...empty() });
    return;
  }
  const state = { stop: false };
  running.set(ch.id, state);
  const started = Date.now();
  const t: Totals = { deleted: 0, pinned: 0, old: 0 };
  let failure: unknown = null;
  try {
    await i.update(progressView(ch.id, count, 0, 0));
    let cursor: string | undefined;
    let shown = 0;
    while (!state.stop && Date.now() - started < MAX_RUN_MS) {
      const room = count ? count - t.deleted : Infinity;
      if (room <= 0) break;
      const page = [...(await ch.messages.fetch({ limit: 100, ...(cursor ? { before: cursor } : {}) })).values()];
      if (!page.length) break;
      cursor = page.reduce((a, b) => (b.createdTimestamp < a.createdTimestamp ? b : a)).id;
      const s = sortPage(page, Date.now(), room);
      t.pinned += s.pinned;
      t.old += s.old;
      if (s.del.length) t.deleted += (await ch.bulkDelete(s.del, true)).size;
      // newest first: once an old message is met, everything after it is old as well
      if (s.old > 0 || page.length < 100) break;
      if (Date.now() - shown > 2000) {
        shown = Date.now();
        await i.editReply(progressView(ch.id, count, t.deleted, Date.now() - started)).catch(() => undefined);
      }
    }
  } catch (e) {
    failure = e;
    log('/clear run failed:', (e as Error).message);
  } finally {
    running.delete(ch.id);
  }
  const elapsed = Date.now() - started;
  if (failure) {
    const code = (failure as { code?: number }).code;
    const text = code === 50013 || code === 50001 ? 'Боту не хватает прав в этом канале: нужны «Просмотр канала», «Читать историю сообщений» и «Управлять сообщениями».' : humanDiscordError(failure);
    const e = doneEmbed(t, elapsed, true, count).setColor(COLORS.bad).setTitle('❌ Очистка прервана').addFields({ name: 'Причина', value: text.slice(0, 500) });
    await i.editReply({ embeds: [e], ...empty() }).catch(() => undefined);
    return;
  }
  await i.editReply({ embeds: [doneEmbed(t, elapsed, state.stop, count)], ...empty() }).catch(() => undefined);
  // a short notice for everybody in the channel; it removes itself
  if (t.deleted && ch.send) {
    const n = new EmbedBuilder().setColor(getStyle().accent).setDescription(`🧹 <@${i.user.id}> очистил(а) канал: удалено **${messages(t.deleted)}**.`).setFooter(footerOf('Очистка'));
    const sent = await ch.send({ embeds: [n], allowedMentions: { parse: [] } }).catch(() => null);
    if (sent) setTimeout(() => void sent.delete().catch(() => undefined), 15_000);
  }
}
