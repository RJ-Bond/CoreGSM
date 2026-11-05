/**
 * /ban, /unban, /kick, /warn, /mute, /unmute and the context menus «Warn»: punishments for the administrators of the server.
 * A reason is required (except for /unban and /unmute); while it is typed the bot offers the reasons of the panel. A ban and
 * a kick wait for a button; a warning is counted by the panel (a scale like ●●○○○, the earlier reasons, the ladder: a mute or a
 * kick after so many warnings). Under every result card there are buttons: «Undo» (thirty seconds), «Another warning»,
 * «Lift the ban», «Lift the mute», «History». The person gets a private message first (a ban has the button of an appeal).
 * The card goes to the moderator privately, to the channel when `public` is chosen, and to the log channel of the panel.
 */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle,
  type AutocompleteInteraction, type ButtonInteraction, type ChatInputCommandInteraction, type Client, type Guild, type MessageContextMenuCommandInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction, type User, type UserContextMenuCommandInteraction,
} from 'discord.js';
import { backendJson } from './backend.js';
import { humanDiscordError } from './errors.js';
import { log } from './log.js';
import {
  BAN_PAGE, DELETE_DAYS, META, MAX_REASON, PICK_ID, PUNISH_TTL_MS, auditReason, banLine, cleanReason, daysText, deleteDays, deleteSeconds, durationHints, durationLabel, idFromInput, isStale, messageLink, newToken, pageId, paginate,
  parseDuration, parsePageId, parsePunishId, parseReasonModal, parseUndoId, parseUserBtn, punishId, reasonHints, reasonModalId, timeTag, undoFresh, warnBar, type PunishAction,
} from './punishLogic.js';
import { EPHEMERAL, appealRow, card, expireUndo, gate, person, publish, recordCase, resultRows, sendDm, settings, standing, type CardData, type CaseAnswer, type CaseBody } from './punishKit.js';
import { COLORS, replyEmbed } from './replies.js';
import { footerOf, getStyle } from './style.js';
import type { Moderation } from './clearLogic.js';

const ADMIN = String(PermissionFlagsBits.Administrator);

const loc = (ru: string, en: string) => ({ ru, 'en-US': en, 'en-GB': en });
const userOpt = (ru: string, en: string) => ({ type: 6, name: 'user', required: true, description: ru, description_localizations: loc(ru, en) });
const reasonOpt = (required: boolean) => ({
  type: 3,
  name: 'reason',
  description: '📝 Причина (подсказки из панели; попадёт в журнал и в ЛС)',
  description_localizations: loc('📝 Причина (подсказки из панели; попадёт в журнал и в ЛС)', '📝 Reason (hints from the panel; goes to the log and to the member)'),
  required,
  max_length: MAX_REASON,
  autocomplete: true,
});
const publicOpt = { type: 5, name: 'public', description: '📣 Показать карточку всем в канале', description_localizations: loc('📣 Показать карточку всем в канале', '📣 Show the card to everybody in the channel'), required: false };
const base = { dm_permission: false, default_member_permissions: ADMIN };

export const PUNISH_COMMANDS = [
  {
    ...base,
    name: 'ban',
    description: '🔨 Заблокировать участника · только админы',
    description_localizations: loc('🔨 Заблокировать участника · только админы', '🔨 Ban a member · admins only'),
    options: [
      userOpt('👤 Кого заблокировать', '👤 Who to ban'),
      reasonOpt(true),
      {
        type: 4,
        name: 'delete',
        description: '🧹 Удалить его сообщения за последнее время',
        description_localizations: loc('🧹 Удалить его сообщения за последнее время', '🧹 Delete his recent messages'),
        required: false,
        choices: DELETE_DAYS.map((d) => ({ name: daysText(d), value: d })),
      },
      publicOpt,
    ],
  },
  {
    ...base,
    name: 'unban',
    description: '🔓 Снять блокировку · только админы',
    description_localizations: loc('🔓 Снять блокировку · только админы', '🔓 Unban a member · admins only'),
    options: [
      { type: 3, name: 'user', description: '👤 Кого разблокировать (пусто — открыть список банов)', description_localizations: loc('👤 Кого разблокировать (пусто — открыть список банов)', '👤 Who to unban (empty — open the ban list)'), required: false, autocomplete: true },
      reasonOpt(false),
      publicOpt,
    ],
  },
  {
    ...base,
    name: 'kick',
    description: '👢 Исключить участника с сервера · только админы',
    description_localizations: loc('👢 Исключить участника с сервера · только админы', '👢 Kick a member · admins only'),
    options: [userOpt('👤 Кого исключить', '👤 Who to kick'), reasonOpt(true), publicOpt],
  },
  {
    ...base,
    name: 'warn',
    description: '⚠️ Вынести предупреждение · только админы',
    description_localizations: loc('⚠️ Вынести предупреждение · только админы', '⚠️ Warn a member · admins only'),
    options: [userOpt('👤 Кому', '👤 Who to warn'), reasonOpt(true), publicOpt],
  },
  {
    ...base,
    name: 'mute',
    description: '🔇 Запретить писать и говорить на время · только админы',
    description_localizations: loc('🔇 Запретить писать и говорить на время · только админы', '🔇 Mute a member for a while · admins only'),
    options: [
      userOpt('👤 Кого заглушить', '👤 Who to mute'),
      { type: 3, name: 'duration', description: '⏳ На сколько: 10m, 1h, 1d, до 28 дней', description_localizations: loc('⏳ На сколько: 10m, 1h, 1d, до 28 дней', '⏳ For how long: 10m, 1h, 1d, up to 28 days'), required: true, autocomplete: true },
      reasonOpt(true),
      publicOpt,
    ],
  },
  {
    ...base,
    name: 'unmute',
    description: '🔊 Снять мут · только админы',
    description_localizations: loc('🔊 Снять мут · только админы', '🔊 Unmute a member · admins only'),
    options: [userOpt('👤 С кого снять мут', '👤 Who to unmute'), reasonOpt(false), publicOpt],
  },
  { ...base, name: '⚠️ Предупредить', type: 2 },
  { ...base, name: '⚠️ Предупредить автора', type: 3 },
];
export const PUNISH_NAMES = new Set(PUNISH_COMMANDS.filter((c) => !('type' in c)).map((c) => c.name));
export const CONTEXT_NAMES = new Set(PUNISH_COMMANDS.filter((c) => 'type' in c).map((c) => c.name));

const ACTION_OF: Record<string, PunishAction> = { ban: 'ban', unban: 'unban', kick: 'kick', warn: 'warn', mute: 'timeout', unmute: 'unmute' };

interface Ctx {
  guild: Guild;
  mod: Moderation;
  actor: User;
  channelId: string;
  client: Client;
}

/** what an action gives: the card and the buttons under it */
interface Outcome {
  embed: EmbedBuilder;
  rows: (undo: boolean) => ActionRowBuilder<ButtonBuilder>[];
  undoable: boolean;
}

/** a refusal with a text for the moderator */
class Refusal extends Error {}

const errText = (e: unknown): string => {
  if (e instanceof Refusal) return e.message;
  const code = (e as { code?: number }).code;
  return code === 50013 ? 'Боту не хватает прав или его роль ниже роли участника.' : humanDiscordError(e);
};

const fail = (title: string, text: string) => ({ ...replyEmbed(title, text, COLORS.bad), components: [] as never[] });

const caseOf = (c: Ctx, target: User, kind: CaseBody['kind'], reason: string, link = ''): CaseBody => ({
  guildId: c.guild.id,
  userId: target.id,
  userName: target.username,
  modId: c.actor.id,
  modName: c.actor.username,
  kind,
  reason,
  link,
});

const rowsFor = (kind: PunishAction, id: number | null, userId: string) => (undo: boolean) => resultRows({ kind, caseId: id, userId, undo });

async function performWarn(c: Ctx, target: User, reason: string, link: string): Promise<Outcome> {
  const w: CaseAnswer | null = await recordCase(caseOf(c, target, 'warn', reason, link));
  const dm = await sendDm(c.guild, target, 'warn', reason, w ? { warnNo: w.total, scale: w.scale, expiresAt: w.expiresAt } : {});
  const auto: string[] = [];
  if (w?.step) auto.push(await autoStep(c, target, w.step));
  const data: CardData = { action: 'warn', target, mod: c.actor, reason, dm, link, auto, ...(w ? { warns: { no: w.total, scale: w.scale, recent: w.recent, expiresAt: w.expiresAt } } : {}) };
  const embed = card(data);
  if (!w) embed.addFields({ name: '⚠️ Счётчик', value: 'Панель не ответила: предупреждение не записано в историю.' });
  return { embed, rows: rowsFor('warn', w?.id ?? null, target.id), undoable: !!w };
}

/** the ladder of the panel: a mute or a kick after so many warnings */
async function autoStep(c: Ctx, target: User, step: NonNullable<CaseAnswer['step']>): Promise<string> {
  const member = await c.guild.members.fetch(target.id).catch(() => null);
  if (!member) return 'участника уже нет на сервере';
  const bot = c.client.user;
  const body = (kind: 'timeout' | 'kick'): CaseBody => ({ ...caseOf(c, target, kind, 'Авто: порог предупреждений'), modId: bot?.id ?? c.actor.id, modName: 'Авто' });
  try {
    if (step.action === 'timeout') {
      await member.timeout(step.minutes * 60_000, auditReason('авто', 'порог предупреждений'));
      await sendDm(c.guild, target, 'timeout', 'Порог предупреждений', { minutes: step.minutes });
      await recordCase(body('timeout'));
      return `мут на ${durationLabel(step.minutes)}`;
    }
    await sendDm(c.guild, target, 'kick', 'Порог предупреждений');
    await c.guild.members.kick(target.id, auditReason('авто', 'порог предупреждений'));
    await recordCase(body('kick'));
    return 'участник исключён с сервера';
  } catch {
    return 'не удалось применить: роль бота ниже или не хватает прав';
  }
}

async function performBan(c: Ctx, target: User, reason: string, days: number): Promise<Outcome> {
  // the person can write an appeal only when somebody receives it
  const appeals = !!(c.mod.appealChannelId || c.mod.logChannelId);
  const dm = await sendDm(c.guild, target, 'ban', reason, {}, appeals ? [appealRow(c.guild.id)] : []);
  await c.guild.members.ban(target.id, { reason: auditReason(c.actor.username, reason), deleteMessageSeconds: deleteSeconds(days) });
  forgetBans(c.guild.id);
  const k = await recordCase(caseOf(c, target, 'ban', reason));
  return { embed: card({ action: 'ban', target, mod: c.actor, reason, dm, days }), rows: rowsFor('ban', k?.id ?? null, target.id), undoable: !!k };
}

async function performKick(c: Ctx, target: User, reason: string): Promise<Outcome> {
  const dm = await sendDm(c.guild, target, 'kick', reason);
  await c.guild.members.kick(target.id, auditReason(c.actor.username, reason));
  const k = await recordCase(caseOf(c, target, 'kick', reason));
  return { embed: card({ action: 'kick', target, mod: c.actor, reason, dm }), rows: rowsFor('kick', k?.id ?? null, target.id), undoable: false };
}

async function performTimeout(c: Ctx, target: User, minutes: number, reason: string): Promise<Outcome> {
  const member = await c.guild.members.fetch(target.id).catch(() => null);
  if (!member) throw new Refusal('Участника нет на сервере: мут выдать нельзя.');
  await member.timeout(minutes * 60_000, auditReason(c.actor.username, reason));
  const dm = await sendDm(c.guild, target, 'timeout', reason, { minutes });
  const k = await recordCase(caseOf(c, target, 'timeout', reason));
  return { embed: card({ action: 'timeout', target, mod: c.actor, reason, dm, minutes }), rows: rowsFor('timeout', k?.id ?? null, target.id), undoable: !!k };
}

async function performUnmute(c: Ctx, target: User, reason: string): Promise<Outcome> {
  const member = await c.guild.members.fetch(target.id).catch(() => null);
  if (!member) throw new Refusal('Участника нет на сервере.');
  if (!member.communicationDisabledUntilTimestamp || member.communicationDisabledUntilTimestamp <= Date.now()) throw new Refusal('У участника нет действующего мута.');
  await member.timeout(null, auditReason(c.actor.username, reason || 'без причины'));
  const dm = await sendDm(c.guild, target, 'unmute', reason);
  const k = await recordCase(caseOf(c, target, 'unmute', reason));
  return { embed: card({ action: 'unmute', target, mod: c.actor, reason, dm }), rows: rowsFor('unmute', k?.id ?? null, target.id), undoable: false };
}

async function performUnban(c: Ctx, id: string, reason: string): Promise<Outcome> {
  try {
    await c.guild.members.unban(id, auditReason(c.actor.username, reason || 'без причины'));
  } catch (e) {
    const code = (e as { code?: number }).code;
    throw new Refusal(code === 10026 ? 'Этого человека нет в списке банов сервера.' : code === 50013 ? 'Боту не хватает права «Банить участников».' : humanDiscordError(e));
  }
  forgetBans(c.guild.id);
  const fetched = await c.client.users.fetch(id).catch(() => null);
  const target = fetched ?? ({ id, username: id, displayAvatarURL: () => '' } as unknown as User);
  const dm = fetched ? await sendDm(c.guild, fetched, 'unban', reason) : null;
  const k = await recordCase(caseOf(c, target, 'unban', reason));
  return { embed: card({ action: 'unban', target, mod: c.actor, reason, dm }), rows: rowsFor('unban', k?.id ?? null, id), undoable: false };
}

type Replying = ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;

/** the card to the moderator, the thirty-second «Undo», the copies to the channel and the log */
async function finish(i: Replying, c: Ctx, out: Outcome, publicCard: boolean): Promise<void> {
  await i.editReply({ embeds: [out.embed], components: out.rows(out.undoable) });
  if (out.undoable) expireUndo(i, out.rows(false));
  await publish(c.client, c.mod, out.embed, publicCard, c.channelId);
}

const ctxOf = (i: Replying, guild: Guild, mod: Moderation): Ctx => ({ guild, mod, actor: i.user, channelId: i.channelId ?? '', client: i.client });

interface Pending {
  action: 'ban' | 'kick';
  modId: string;
  targetId: string;
  reason: string;
  days: number;
  publicCard: boolean;
  at: number;
}
/** a ban or a kick waits here for the button */
const pending = new Map<string, Pending>();

export async function handlePunish(i: ChatInputCommandInteraction): Promise<void> {
  const action = ACTION_OF[i.commandName];
  if (!action) return;
  try {
    await i.deferReply({ flags: EPHEMERAL });
    const g = await gate(i, action);
    if (!('mod' in g)) {
      await i.editReply(fail(g.title, g.text));
      return;
    }
    const guild = i.guild as Guild;
    const c = ctxOf(i, guild, g.mod);
    const reason = cleanReason(i.options.getString('reason'));
    const publicCard = i.options.getBoolean('public') ?? false;
    if (action === 'unban') {
      const input = i.options.getString('user');
      if (!input) {
        const rows = await loadBans(guild, true);
        await i.editReply(rows ? banListView(rows, 0) : fail('Не получилось', 'Не удалось прочитать список банов: боту нужно право «Банить участников».'));
        return;
      }
      const id = idFromInput(input);
      if (!id) {
        await i.editReply(fail('Не понял, кого', 'Выберите участника из подсказок, впишите его ID (число) или оставьте поле пустым, чтобы открыть список банов.'));
        return;
      }
      await finish(i, c, await performUnban(c, id, reason), publicCard);
      return;
    }
    const target = i.options.getUser('user', true);
    const why = await standing(guild, i.user.id, target);
    if (why) {
      await i.editReply(fail('Нельзя', why));
      return;
    }
    if (action === 'warn') return await finish(i, c, await performWarn(c, target, reason, ''), publicCard);
    if (action === 'unmute') return await finish(i, c, await performUnmute(c, target, reason), publicCard);
    if (action === 'timeout') {
      const minutes = parseDuration(i.options.getString('duration', true));
      if (!minutes) {
        await i.editReply(fail('Не понял срок', 'Напишите число с единицей: `30m`, `2h`, `1d`, `7d` (минуты, часы, дни; не больше 28 дней).'));
        return;
      }
      return await finish(i, c, await performTimeout(c, target, minutes, reason), publicCard);
    }
    // a ban and a kick wait for a button
    const days = deleteDays(i.options.getInteger('delete'));
    const token = newToken();
    pending.set(token, { action: action as 'ban' | 'kick', modId: i.user.id, targetId: target.id, reason, days, publicCard, at: Date.now() });
    if (pending.size > 100) for (const [k, v] of pending) if (isStale(v.at, Date.now())) pending.delete(k);
    const m = META[action];
    const e = new EmbedBuilder()
      .setColor(COLORS.warn)
      .setTitle(`${m.emoji} ${action === 'ban' ? 'Заблокировать участника?' : 'Исключить участника?'}`)
      .setDescription(action === 'ban' ? 'Участник потеряет доступ к серверу. Ему придёт личное сообщение с кнопкой апелляции. Разблокировать можно командой `/unban`.' : 'Участник будет исключён, но сможет вернуться по новому приглашению.')
      .setThumbnail(target.displayAvatarURL({ size: 128 }))
      .addFields({ name: '👤 Участник', value: person(target), inline: true }, { name: '📝 Причина', value: reason })
      .setFooter(footerOf(`Подтвердите в течение ${Math.round(PUNISH_TTL_MS / 60_000)} мин`));
    if (action === 'ban') e.addFields({ name: '🧹 Его сообщения', value: daysText(days), inline: true });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(punishId('go', token)).setLabel(action === 'ban' ? 'Да, забанить' : 'Да, исключить').setEmoji(m.emoji).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(punishId('no', token)).setLabel('Отмена').setStyle(ButtonStyle.Secondary),
    );
    await i.editReply({ embeds: [e], components: [row] });
  } catch (e) {
    log(`/${i.commandName} failed:`, (e as Error).message);
    await i.editReply(fail('Не получилось', errText(e))).catch(() => undefined);
  }
}

const isAdmin = (i: { memberPermissions: { has: (p: bigint) => boolean } | null }) => !!i.memberPermissions?.has(PermissionFlagsBits.Administrator);

/** the window with the reason of a warning */
const reasonModal = (id: string, name: string) =>
  new ModalBuilder()
    .setCustomId(id)
    .setTitle(`⚠️ Предупреждение: ${name}`.slice(0, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(MAX_REASON).setPlaceholder('Например: спам в чате')));

/** the context menus «Warn» on a member and on a message: the window opens at once, the checks run when it is sent */
export async function handleContext(i: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction): Promise<void> {
  try {
    if (!isAdmin(i)) {
      await i.reply({ ...fail('Недостаточно прав', 'Эта команда доступна только администраторам сервера.'), flags: EPHEMERAL });
      return;
    }
    if (i.isMessageContextMenuCommand()) {
      const m = i.targetMessage;
      await i.showModal(reasonModal(reasonModalId(m.author.id, m.channelId, m.id), m.author.username));
    } else {
      await i.showModal(reasonModal(reasonModalId(i.targetUser.id), i.targetUser.username));
    }
  } catch (e) {
    log('context menu failed:', (e as Error).message);
  }
}

/** the window with a reason was sent: the warning is given */
export async function handleReasonModal(i: ModalSubmitInteraction): Promise<void> {
  const p = parseReasonModal(i.customId);
  if (!p) return;
  try {
    await i.deferReply({ flags: EPHEMERAL });
    const reason = cleanReason(i.fields.getTextInputValue('reason'));
    if (!reason) {
      await i.editReply(fail('Нужна причина', 'Напишите, за что предупреждение.'));
      return;
    }
    const g = await gate(i, 'warn');
    if (!('mod' in g)) {
      await i.editReply(fail(g.title, g.text));
      return;
    }
    const guild = i.guild as Guild;
    const target = await i.client.users.fetch(p.userId);
    const why = await standing(guild, i.user.id, target);
    if (why) {
      await i.editReply(fail('Нельзя', why));
      return;
    }
    const link = p.chan !== '0' && p.msg !== '0' ? messageLink(guild.id, p.chan, p.msg) : '';
    const c = ctxOf(i, guild, g.mod);
    await finish(i, c, await performWarn(c, target, reason, link), false);
  } catch (e) {
    log('reason window failed:', (e as Error).message);
    await i.editReply(fail('Не получилось', errText(e))).catch(() => undefined);
  }
}

interface Hist {
  total: number;
  scale: number;
  items: { id: number; kind: string; reason: string; createdAt: number; expiresAt: number | null; revokedAt: number | null; modName: string; link: string }[];
}

function historyEmbed(user: User, h: Hist): EmbedBuilder {
  const now = Date.now();
  const line = (x: Hist['items'][number]) => {
    const meta = META[x.kind as PunishAction];
    const state = x.revokedAt ? ' · ↩️ снято' : x.expiresAt && x.expiresAt < now ? ' · ⌛ истекло' : '';
    return `${meta?.emoji ?? '•'} **${meta?.title ?? x.kind}** ${timeTag(x.createdAt)} · ${x.modName || '—'}${state}\n${x.reason ? `> ${x.reason.replace(/\n/g, ' ').slice(0, 150)}` : '> без причины'}${x.link ? ` · [сообщение](${x.link})` : ''}`;
  };
  return new EmbedBuilder()
    .setColor(h.total ? 0xe67e22 : COLORS.ok)
    .setTitle(`📜 История: ${user.username}`.slice(0, 250))
    .setThumbnail(user.displayAvatarURL({ size: 128 }) || null)
    .setDescription(`${warnBar(h.total, h.scale)} действующих предупреждений\n\n${h.items.length ? h.items.map(line).join('\n\n').slice(0, 3400) : 'Записей пока нет.'}`)
    .setFooter(footerOf('Досье'));
}

export async function handlePunishButton(i: ButtonInteraction): Promise<void> {
  const page = parsePageId(i.customId);
  if (page !== null) return handleBanPage(i, page);
  const undo = parseUndoId(i.customId);
  if (undo) return handleUndo(i, undo.caseId, undo.at);
  const ub = parseUserBtn(i.customId);
  if (ub) return handleUserButton(i, ub.kind, ub.userId);
  const p = parsePunishId(i.customId);
  if (!p) return;
  try {
    const job = pending.get(p.token);
    if (!job || isStale(job.at, Date.now())) {
      pending.delete(p.token);
      await i.update({ ...replyEmbed('Время вышло', 'Подтверждение устарело. Наберите команду ещё раз.', COLORS.warn), components: [] });
      return;
    }
    if (i.user.id !== job.modId) {
      await i.reply({ ...replyEmbed('Это не ваше действие', 'Подтвердить может только тот, кто набрал команду.', COLORS.warn), flags: EPHEMERAL });
      return;
    }
    pending.delete(p.token);
    if (p.action === 'no') {
      await i.update({ ...replyEmbed('Отменено', 'Ничего не сделано.', COLORS.ok), components: [] });
      return;
    }
    await i.deferUpdate();
    const g = await gate(i, job.action);
    if (!('mod' in g)) {
      await i.editReply(fail(g.title, g.text));
      return;
    }
    const guild = i.guild as Guild;
    const target = await i.client.users.fetch(job.targetId);
    const why = await standing(guild, i.user.id, target);
    if (why) {
      await i.editReply(fail('Нельзя', why));
      return;
    }
    const c = ctxOf(i, guild, g.mod);
    const out = job.action === 'ban' ? await performBan(c, target, job.reason, job.days) : await performKick(c, target, job.reason);
    await finish(i, c, out, job.publicCard);
  } catch (e) {
    log('moderation button failed:', (e as Error).message);
    const out = fail('Не получилось', errText(e));
    await (i.deferred || i.replied ? i.editReply(out) : i.update(out)).catch(() => undefined);
  }
}

/** «Undo» under a card: the record is withdrawn and a ban or a mute is lifted (thirty seconds after the action) */
async function handleUndo(i: ButtonInteraction, caseId: number, at: number): Promise<void> {
  try {
    if (!isAdmin(i)) {
      await i.reply({ ...fail('Недостаточно прав', 'Только для администраторов сервера.'), flags: EPHEMERAL });
      return;
    }
    if (!undoFresh(at, Date.now())) {
      await i.reply({ ...replyEmbed('Время отмены прошло', 'Отменить можно только в первые 30 секунд. Снимите наказание кнопкой «Снять бан», «Снять мут» или командой.', COLORS.warn), flags: EPHEMERAL });
      return;
    }
    await i.deferUpdate();
    const g = await gate(i, 'warn');
    if (!('mod' in g)) {
      await i.editReply(fail(g.title, g.text));
      return;
    }
    const guild = i.guild as Guild;
    const r = await backendJson<{ kind: string; userId: string }>(`/internal/cases/${caseId}/revoke`, { method: 'POST', body: JSON.stringify({ by: i.user.username }) }).catch(() => null);
    if (!r?.ok || !r.data) {
      await i.editReply(fail('Не получилось', 'Панель не нашла запись для отмены.'));
      return;
    }
    const { kind, userId } = r.data;
    let tail = '';
    if (kind === 'ban') {
      await guild.members.unban(userId, auditReason(i.user.username, 'отмена в течение 30 секунд'));
      forgetBans(guild.id);
    } else if (kind === 'timeout') {
      const m = await guild.members.fetch(userId).catch(() => null);
      await m?.timeout(null, auditReason(i.user.username, 'отмена в течение 30 секунд'));
    } else if (kind === 'warn') {
      tail = ' Мут или кик лесенки, если они были, нужно снять отдельно.';
    }
    const meta = META[kind as PunishAction];
    const e = new EmbedBuilder()
      .setColor(COLORS.ok)
      .setTitle('↩️ Действие отменено')
      .setDescription(`${meta?.emoji ?? ''} ${meta?.title ?? kind}: <@${userId}> — отменено ${person(i.user)}.${tail}`)
      .setTimestamp(new Date())
      .setFooter(footerOf('Модерация'));
    await i.editReply({ embeds: [e], components: [] });
    await publish(i.client, g.mod, e, false, i.channelId);
  } catch (e) {
    log('undo failed:', (e as Error).message);
    await i.followUp({ ...fail('Не получилось', errText(e)), flags: EPHEMERAL }).catch(() => undefined);
  }
}

/** the buttons «Another warning», «Lift the ban», «Lift the mute», «History» under a card */
async function handleUserButton(i: ButtonInteraction, kind: 'hist' | 'more' | 'unb' | 'unm', userId: string): Promise<void> {
  try {
    if (!isAdmin(i)) {
      await i.reply({ ...fail('Недостаточно прав', 'Только для администраторов сервера.'), flags: EPHEMERAL });
      return;
    }
    if (kind === 'more') {
      const u = await i.client.users.fetch(userId);
      await i.showModal(reasonModal(reasonModalId(userId), u.username));
      return;
    }
    await i.deferReply({ flags: EPHEMERAL });
    const guild = i.guild as Guild;
    const user = await i.client.users.fetch(userId);
    if (kind === 'hist') {
      const r = await backendJson<Hist>(`/internal/cases?guild=${guild.id}&user=${userId}`).catch(() => null);
      await i.editReply(r?.ok && r.data ? { embeds: [historyEmbed(user, r.data)] } : fail('Панель не отвечает', 'Не удалось получить историю.'));
      return;
    }
    const action: PunishAction = kind === 'unb' ? 'unban' : 'unmute';
    const g = await gate(i, action);
    if (!('mod' in g)) {
      await i.editReply(fail(g.title, g.text));
      return;
    }
    const c = ctxOf(i, guild, g.mod);
    await finish(i, c, kind === 'unb' ? await performUnban(c, userId, 'кнопка в карточке') : await performUnmute(c, user, 'кнопка в карточке'), false);
  } catch (e) {
    log('user button failed:', (e as Error).message);
    await (i.deferred || i.replied ? i.editReply(fail('Не получилось', errText(e))) : i.reply({ ...fail('Не получилось', errText(e)), flags: EPHEMERAL })).catch(() => undefined);
  }
}

interface BanRow { id: string; username: string; reason: string }
/** the ban list of a server, kept a minute (it is read again after each ban or unban) */
const banCache = new Map<string, { at: number; list: BanRow[] }>();

async function loadBans(guild: Guild, fresh = false): Promise<BanRow[] | null> {
  const hit = banCache.get(guild.id);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.list;
  const bans = await guild.bans.fetch({ limit: 1000 }).catch(() => null);
  if (!bans) return null;
  const list = [...bans.values()].map((b) => ({ id: b.user.id, username: b.user.username, reason: b.reason ?? '' }));
  banCache.set(guild.id, { at: Date.now(), list });
  return list;
}

/** a new ban list is read after the next ban or unban */
const forgetBans = (guildId: string): void => void banCache.delete(guildId);

/** the list of the banned: a page of lines, a menu to pick whom to unban, buttons for the pages */
function banListView(rows: BanRow[], pageNo: number) {
  const pg = paginate(rows.length, pageNo, BAN_PAGE);
  const slice = rows.slice(pg.from, pg.to);
  const e = new EmbedBuilder()
    .setColor(getStyle().accent)
    .setTitle('🔓 Список банов')
    .setDescription(slice.length ? slice.map(banLine).join('\n') : 'Список банов пуст: никто не заблокирован.')
    .setFooter(footerOf(`Страница ${pg.page + 1} из ${pg.pages} · всего ${rows.length}`));
  const components: (ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>)[] = [];
  if (slice.length) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(PICK_ID)
          .setPlaceholder('🔓 Выберите, кого разблокировать')
          .addOptions(slice.map((b) => new StringSelectMenuOptionBuilder().setLabel(b.username.slice(0, 100) || b.id).setDescription(`ID ${b.id}${b.reason ? ` · ${b.reason}` : ''}`.slice(0, 100)).setValue(b.id))),
      ),
    );
  }
  if (pg.pages > 1) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(pageId(pg.page - 1)).setLabel('Назад').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(pg.page === 0),
        new ButtonBuilder().setCustomId(pageId(pg.page + 1)).setLabel('Дальше').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(pg.page >= pg.pages - 1),
      ),
    );
  }
  return { embeds: [e], components };
}

async function handleBanPage(i: ButtonInteraction, page: number): Promise<void> {
  try {
    await i.deferUpdate();
    if (!i.guild || !isAdmin(i)) return;
    const rows = await loadBans(i.guild);
    await i.editReply(rows ? banListView(rows, page) : fail('Не получилось', 'Не удалось прочитать список банов: боту нужно право «Банить участников».'));
  } catch (e) {
    log('ban list page failed:', (e as Error).message);
  }
}

/** a choice in the menu of the ban list: the person is unbanned, the list is shown again without them */
export async function handleBanPick(i: StringSelectMenuInteraction): Promise<void> {
  if (i.customId !== PICK_ID) return;
  try {
    await i.deferUpdate();
    const g = await gate(i, 'unban');
    if (!('mod' in g)) {
      await i.followUp({ ...fail(g.title, g.text), flags: EPHEMERAL });
      return;
    }
    const guild = i.guild as Guild;
    const c: Ctx = { guild, mod: g.mod, actor: i.user, channelId: i.channelId ?? '', client: i.client };
    const out = await performUnban(c, i.values[0] ?? '', 'снят через список банов');
    const rows = await loadBans(guild, true);
    await i.editReply(rows ? banListView(rows, 0) : { embeds: [out.embed], components: [] });
    await i.followUp({ embeds: [out.embed], components: out.rows(false), flags: EPHEMERAL });
    await publish(i.client, g.mod, out.embed, false, i.channelId ?? '');
  } catch (e) {
    log('ban list pick failed:', (e as Error).message);
    await i.followUp({ ...fail('Не получилось', errText(e)), flags: EPHEMERAL }).catch(() => undefined);
  }
}

/** the reasons of the panel are kept half a minute: autocomplete must answer in three seconds */
let reasonsAt = 0;
let reasonsList: string[] = [];
async function reasons(): Promise<string[]> {
  if (Date.now() - reasonsAt > 30_000) {
    const m = await settings();
    if (m) {
      reasonsList = m.reasons;
      reasonsAt = Date.now();
    }
  }
  return reasonsList;
}

/** hints: the reasons of the panel, the lengths of a mute, the banned members for /unban */
export async function punishAutocomplete(i: AutocompleteInteraction): Promise<void> {
  try {
    if (!i.guild || !i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return void (await i.respond([]));
    const f = i.options.getFocused(true);
    if (f.name === 'reason') return void (await i.respond(reasonHints(await reasons(), f.value)));
    if (f.name === 'duration') return void (await i.respond(durationHints(f.value)));
    if (i.commandName !== 'unban' || f.name !== 'user') return void (await i.respond([]));
    const list = (await loadBans(i.guild)) ?? [];
    const q = f.value.trim().toLowerCase();
    const found = list.filter((b) => !q || b.username.toLowerCase().includes(q) || b.id.startsWith(q)).slice(0, 24).map((b) => ({ name: `${b.username} · ${b.id}`.slice(0, 100), value: b.id }));
    const typed = idFromInput(q);
    if (typed && !found.some((x) => x.value === typed)) found.push({ name: `ID ${typed}`, value: typed });
    await i.respond(found);
  } catch (e) {
    log('moderation autocomplete failed:', (e as Error).message);
    await i.respond([]).catch(() => undefined);
  }
}
