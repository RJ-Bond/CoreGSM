/** What the moderation commands share: the settings of the panel, the records, the cards, private messages, buttons, the log. */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, type ChatInputCommandInteraction, type Client, type Guild, type User } from 'discord.js';
import { backendJson } from './backend.js';
import { readModeration, type Moderation } from './clearLogic.js';
import { log } from './log.js';
import { footerOf } from './style.js';
import { META, UNDO_MS, appealGoId, dmText, escalationHint, standingProblem, timeTag, undoId, userBtnId, warnBar, warnColor, daysText, durationLabel, type DmOpts, type PunishAction } from './punishLogic.js';

export const EPHEMERAL = 64;

export async function settings(): Promise<Moderation | null> {
  const r = await backendJson<unknown>('/internal/moderation').catch(() => null);
  return r?.ok ? readModeration(r.data) : null;
}

/** the answer of the panel to a new record */
export interface CaseAnswer {
  id: number;
  createdAt: number;
  expiresAt: number | null;
  /** active warnings after this one */
  total: number;
  recent: { reason: string; createdAt: number }[];
  scale: number;
  step: { action: 'timeout'; minutes: number } | { action: 'kick' } | null;
}

export interface CaseBody {
  guildId: string;
  userId: string;
  userName: string;
  modId: string;
  modName: string;
  kind: 'warn' | 'ban' | 'unban' | 'kick' | 'timeout' | 'unmute' | 'appeal';
  reason: string;
  link?: string;
}

export async function recordCase(body: CaseBody): Promise<CaseAnswer | null> {
  const r = await backendJson<CaseAnswer>('/internal/cases', { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
  return r?.ok ? r.data : null;
}

/** the user as a line: mention and name */
export const person = (u: { id: string; username: string }): string => `<@${u.id}> (${u.username})`;

export interface CardData {
  action: PunishAction;
  target: User;
  mod: { id: string; username: string };
  reason: string;
  /** the private message was delivered (null = none was tried) */
  dm: boolean | null;
  days?: number;
  /** the length of a mute, minutes */
  minutes?: number;
  link?: string;
  warns?: { no: number; scale: number; recent: { reason: string; createdAt: number }[]; expiresAt: number | null };
  /** what the ladder of the panel did by itself */
  auto?: string[];
}

/** the card of a result: the same for the moderator, the channel and the log, coloured by the kind of the action */
export function card(d: CardData): EmbedBuilder {
  const m = META[d.action];
  const w = d.warns;
  const e = new EmbedBuilder()
    .setColor(w ? warnColor(w.no, w.scale) : m.color)
    .setTitle(`${m.emoji} ${m.title}${w ? ` №${w.no}` : ''}`)
    .setDescription(`<@${d.target.id}> ${m.done}.${w ? `\n\n${warnBar(w.no, w.scale)}` : ''}`)
    .setThumbnail(d.target.displayAvatarURL({ size: 128 }) || null)
    .addFields({ name: '👤 Участник', value: person(d.target), inline: true }, { name: '🛡️ Модератор', value: person(d.mod), inline: true }, { name: '📝 Причина', value: d.reason || 'не указана' })
    .setTimestamp(new Date())
    .setFooter(footerOf('Модерация'));
  if (d.link) e.addFields({ name: '🔗 Основание', value: `[сообщение](${d.link})`, inline: true });
  if (d.action === 'ban' && d.days !== undefined) e.addFields({ name: '🧹 Его сообщения', value: daysText(d.days), inline: true });
  if (d.action === 'timeout' && d.minutes) {
    const until = Date.now() + d.minutes * 60_000;
    e.addFields({ name: '⏳ Срок', value: `${durationLabel(d.minutes)} · до ${timeTag(until)}`, inline: true });
  }
  if (d.dm !== null) e.addFields({ name: '✉️ Личное сообщение', value: d.dm ? 'доставлено' : 'не доставлено (закрыты ЛС)', inline: true });
  if (w) {
    if (w.expiresAt) e.addFields({ name: '⌛ Перестанет учитываться', value: timeTag(w.expiresAt), inline: true });
    if (w.recent.length) e.addFields({ name: '📜 Предыдущие', value: w.recent.map((x) => `${timeTag(x.createdAt)} — ${x.reason}`.slice(0, 200)).join('\n').slice(0, 1000) });
    const hint = d.auto?.length ? '' : escalationHint(w.no);
    if (hint) e.addFields({ name: '🚨 Внимание', value: hint });
  }
  if (d.auto?.length) e.addFields({ name: '🤖 Лесенка наказаний', value: d.auto.join('\n').slice(0, 1000) });
  return e;
}

/** a private message to the person; false when Discord does not let us (closed messages) */
export async function sendDm(guild: Guild, target: User, action: PunishAction, reason: string, opts: DmOpts = {}, rows: ActionRowBuilder<ButtonBuilder>[] = []): Promise<boolean> {
  const t = dmText(action, guild.name, opts);
  const icon = guild.iconURL({ size: 128 });
  const e = new EmbedBuilder()
    .setColor(opts.warnNo && opts.scale ? warnColor(opts.warnNo, opts.scale) : META[action].color)
    .setAuthor({ name: guild.name, ...(icon ? { iconURL: icon } : {}) })
    .setTitle(t.title)
    .setDescription(t.text)
    .addFields({ name: '📝 Причина', value: reason || 'не указана' })
    .setTimestamp(new Date())
    .setFooter({ text: guild.name });
  if (icon) e.setThumbnail(icon);
  return target.send({ embeds: [e], components: rows }).then(() => true, () => false);
}

type Sendable = { send?: (o: unknown) => Promise<unknown> } | null;

/** the card to the channel (when `public`) and to the log channel of the panel */
export async function publish(client: Client, mod: Moderation, e: EmbedBuilder, publicCard: boolean, channelId: string): Promise<void> {
  const to = async (id: string) => {
    try {
      const ch = (await client.channels.fetch(id)) as unknown as Sendable;
      await ch?.send?.({ embeds: [e], allowedMentions: { parse: [] } });
    } catch (err) {
      log('moderation post failed:', (err as Error).message);
    }
  };
  if (publicCard) await to(channelId);
  if (mod.logChannelId && !(publicCard && mod.logChannelId === channelId)) await to(mod.logChannelId);
}

/** the permission the bot needs for an action */
export const BOT_NEEDS: Record<PunishAction, bigint | null> = {
  ban: PermissionFlagsBits.BanMembers,
  unban: PermissionFlagsBits.BanMembers,
  kick: PermissionFlagsBits.KickMembers,
  warn: null,
  timeout: PermissionFlagsBits.ModerateMembers,
  unmute: PermissionFlagsBits.ModerateMembers,
};
export const BOT_NEEDS_TEXT: Record<PunishAction, string> = {
  ban: 'Боту нужно право «Банить участников».',
  unban: 'Боту нужно право «Банить участников».',
  kick: 'Боту нужно право «Выгонять участников».',
  warn: '',
  timeout: 'Боту нужно право «Отправлять участников подумать о своём поведении» (тайм-аут).',
  unmute: 'Боту нужно право «Отправлять участников подумать о своём поведении» (тайм-аут).',
};

type Gated = Pick<ChatInputCommandInteraction, 'guild' | 'memberPermissions' | 'appPermissions'>;

/** the checks shared by every command; a text for the moderator when something forbids the action */
export async function gate(i: Gated, action: PunishAction): Promise<{ title: string; text: string } | { mod: Moderation }> {
  if (!i.guild) return { title: 'Только на сервере', text: 'Команда работает на Discord-сервере.' };
  if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return { title: 'Недостаточно прав', text: 'Эта команда доступна только администраторам сервера.' };
  const need = BOT_NEEDS[action];
  if (need && i.appPermissions && !i.appPermissions.has(need)) return { title: 'Недостаточно прав', text: `${BOT_NEEDS_TEXT[action]} Выдайте его роли бота или пригласите бота заново по ссылке из панели.` };
  const mod = await settings();
  if (!mod) return { title: 'Панель не отвечает', text: 'Не удалось получить настройки модерации. Попробуйте ещё раз чуть позже.' };
  if (!mod.punish) return { title: 'Команды выключены', text: 'Администратор отключил команды наказаний в панели (Discord → Модерация).' };
  return { mod };
}

/** may the moderator act on this person: a text for the refusal, or null */
export async function standing(guild: Guild, modId: string, target: User): Promise<string | null> {
  const [me, mod, member] = await Promise.all([guild.members.fetchMe().catch(() => null), guild.members.fetch(modId).catch(() => null), guild.members.fetch(target.id).catch(() => null)]);
  return standingProblem({
    targetId: target.id,
    modId,
    botId: guild.client.user.id,
    ownerId: guild.ownerId,
    inGuild: !!member,
    targetPos: member?.roles.highest.position ?? 0,
    modPos: mod?.roles.highest.position ?? 0,
    botPos: me?.roles.highest.position ?? 0,
  });
}

/** the buttons under a result card; «Undo» exists only while `undo` is true (thirty seconds) */
export function resultRows(o: { kind: PunishAction; caseId: number | null; userId: string; undo: boolean }): ActionRowBuilder<ButtonBuilder>[] {
  const b: ButtonBuilder[] = [];
  if (o.undo && o.caseId && (o.kind === 'warn' || o.kind === 'ban' || o.kind === 'timeout')) {
    b.push(new ButtonBuilder().setCustomId(undoId(o.caseId, Date.now())).setLabel('Отменить').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  }
  if (o.kind === 'warn') b.push(new ButtonBuilder().setCustomId(userBtnId('more', o.userId)).setLabel('Ещё предупреждение').setEmoji('➕').setStyle(ButtonStyle.Secondary));
  if (o.kind === 'ban') b.push(new ButtonBuilder().setCustomId(userBtnId('unb', o.userId)).setLabel('Снять бан').setEmoji('🔓').setStyle(ButtonStyle.Secondary));
  if (o.kind === 'timeout') b.push(new ButtonBuilder().setCustomId(userBtnId('unm', o.userId)).setLabel('Снять мут').setEmoji('🔊').setStyle(ButtonStyle.Secondary));
  b.push(new ButtonBuilder().setCustomId(userBtnId('hist', o.userId)).setLabel('История').setEmoji('📜').setStyle(ButtonStyle.Secondary));
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(b)];
}

/** the button of an appeal under the private message of a ban */
export const appealRow = (guildId: string): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(appealGoId(guildId)).setLabel('Подать апелляцию').setEmoji('📨').setStyle(ButtonStyle.Primary));

interface Replier {
  editReply(o: { components: ActionRowBuilder<ButtonBuilder>[] }): Promise<unknown>;
}

/** after thirty seconds the «Undo» button goes away */
export function expireUndo(i: Replier, rowsWithout: ActionRowBuilder<ButtonBuilder>[]): void {
  setTimeout(() => void i.editReply({ components: rowsWithout }).catch(() => undefined), UNDO_MS);
}
