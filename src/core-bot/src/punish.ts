/**
 * /ban, /unban, /kick, /warn: punishments for the administrators of the server, in the style of the other cards of the bot.
 * A reason is required for a ban, a kick and a warning (it goes to the audit log of Discord, to the private message of the
 * person and to the card). A ban and a kick are asked to be confirmed with a button (two minutes); a warning is counted by the
 * panel (the card shows its number and the earlier reasons). The person gets a private message first, when Discord lets us.
 * The result goes to the moderator privately, to the channel when `public` is chosen, and to the log channel of the panel.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, type AutocompleteInteraction, type ButtonInteraction, type ChatInputCommandInteraction, type Guild, type User } from 'discord.js';
import { backendJson } from './backend.js';
import { readModeration, type Moderation } from './clearLogic.js';
import { humanDiscordError } from './errors.js';
import { log } from './log.js';
import { COLORS, replyEmbed } from './replies.js';
import { footerOf } from './style.js';
import { DELETE_DAYS, META, PUNISH_TTL_MS, auditReason, cleanReason, daysText, deleteDays, deleteSeconds, dmText, escalationHint, idFromInput, isStale, newToken, parsePunishId, punishId, standingProblem, timeTag, MAX_REASON, type PunishAction } from './punishLogic.js';

const EPHEMERAL = 64;
const ADMIN = String(PermissionFlagsBits.Administrator);

const loc = (ru: string, en: string) => ({ ru, 'en-US': en, 'en-GB': en });
const userOpt = { type: 6, name: 'user', required: true };
const reasonOpt = (required: boolean) => ({
  type: 3,
  name: 'reason',
  description: '📝 Причина (попадёт в журнал и в ЛС участнику)',
  description_localizations: loc('📝 Причина (попадёт в журнал и в ЛС участнику)', '📝 Reason (goes to the log and to the member)'),
  required,
  max_length: MAX_REASON,
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
      { ...userOpt, description: '👤 Кого заблокировать', description_localizations: loc('👤 Кого заблокировать', '👤 Who to ban') },
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
      { type: 3, name: 'user', description: '👤 Кого разблокировать (имя или ID из списка банов)', description_localizations: loc('👤 Кого разблокировать (имя или ID из списка банов)', '👤 Who to unban (name or ID from the ban list)'), required: true, autocomplete: true },
      reasonOpt(false),
      publicOpt,
    ],
  },
  {
    ...base,
    name: 'kick',
    description: '👢 Исключить участника с сервера · только админы',
    description_localizations: loc('👢 Исключить участника с сервера · только админы', '👢 Kick a member · admins only'),
    options: [{ ...userOpt, description: '👤 Кого исключить', description_localizations: loc('👤 Кого исключить', '👤 Who to kick') }, reasonOpt(true), publicOpt],
  },
  {
    ...base,
    name: 'warn',
    description: '⚠️ Вынести предупреждение · только админы',
    description_localizations: loc('⚠️ Вынести предупреждение · только админы', '⚠️ Warn a member · admins only'),
    options: [{ ...userOpt, description: '👤 Кому', description_localizations: loc('👤 Кому', '👤 Who to warn') }, reasonOpt(true), publicOpt],
  },
];
export const PUNISH_NAMES = new Set(PUNISH_COMMANDS.map((c) => c.name));

/** the permission the bot needs for an action */
const BOT_NEEDS: Record<PunishAction, bigint | null> = { ban: PermissionFlagsBits.BanMembers, unban: PermissionFlagsBits.BanMembers, kick: PermissionFlagsBits.KickMembers, warn: null };
const BOT_NEEDS_TEXT: Record<PunishAction, string> = {
  ban: 'Боту нужно право «Банить участников».',
  unban: 'Боту нужно право «Банить участников».',
  kick: 'Боту нужно право «Выгонять участников».',
  warn: '',
};

interface Pending {
  action: 'ban' | 'kick';
  modId: string;
  targetId: string;
  reason: string;
  days: number;
  publicCard: boolean;
  channelId: string;
  at: number;
}
/** a ban or a kick waits here for the button */
const pending = new Map<string, Pending>();

interface Warns { id: number; total: number; recent: { reason: string; createdAt: number }[] }

const noPerm = (text: string) => ({ ...replyEmbed('Недостаточно прав', text, COLORS.bad), components: [] as never[] });

async function settings(): Promise<Moderation | null> {
  const r = await backendJson<unknown>('/internal/moderation').catch(() => null);
  return r?.ok ? readModeration(r.data) : null;
}

/** the user card as a line: mention and name */
const person = (u: { id: string; username: string }) => `<@${u.id}> (${u.username})`;

interface CardData {
  action: PunishAction;
  target: User;
  mod: User;
  reason: string;
  dm: boolean | null;
  days?: number;
  warns?: { no: number; recent: { reason: string; createdAt: number }[] };
}

function card(d: CardData): EmbedBuilder {
  const m = META[d.action];
  const e = new EmbedBuilder()
    .setColor(m.color)
    .setTitle(`${m.emoji} ${m.title}${d.warns ? ` №${d.warns.no}` : ''}`)
    .setDescription(`<@${d.target.id}> ${m.done}.`)
    .setThumbnail(d.target.displayAvatarURL({ size: 128 }))
    .addFields({ name: '👤 Участник', value: person(d.target), inline: true }, { name: '🛡️ Модератор', value: person(d.mod), inline: true }, { name: '📝 Причина', value: d.reason || 'не указана' })
    .setTimestamp(new Date())
    .setFooter(footerOf('Модерация'));
  if (d.action === 'ban' && d.days !== undefined) e.addFields({ name: '🧹 Его сообщения', value: daysText(d.days), inline: true });
  if (d.dm !== null) e.addFields({ name: '✉️ Личное сообщение', value: d.dm ? 'доставлено' : 'не доставлено (закрыты ЛС)', inline: true });
  if (d.warns) {
    if (d.warns.recent.length) e.addFields({ name: '📜 Предыдущие', value: d.warns.recent.map((w) => `${timeTag(w.createdAt)} — ${w.reason}`.slice(0, 200)).join('\n').slice(0, 1000) });
    const hint = escalationHint(d.warns.no);
    if (hint) e.addFields({ name: '🚨 Внимание', value: hint });
  }
  return e;
}

/** a private message to the person; false when Discord does not let us (closed messages) */
async function sendDm(guild: Guild, target: User, action: PunishAction, reason: string, warnNo?: number): Promise<boolean> {
  const t = dmText(action, guild.name, warnNo);
  const e = new EmbedBuilder()
    .setColor(META[action].color)
    .setTitle(t.title)
    .setDescription(t.text)
    .addFields({ name: '📝 Причина', value: reason || 'не указана' })
    .setFooter({ text: guild.name, ...(guild.iconURL() ? { iconURL: guild.iconURL() as string } : {}) });
  const icon = guild.iconURL({ size: 128 });
  if (icon) e.setThumbnail(icon);
  return target.send({ embeds: [e] }).then(() => true, () => false);
}

type Sendable = { send?: (o: unknown) => Promise<unknown> } | null;

/** the card to the channel (when `public`) and to the log channel of the panel */
async function publish(i: ChatInputCommandInteraction | ButtonInteraction, mod: Moderation, e: EmbedBuilder, publicCard: boolean, channelId: string): Promise<void> {
  const to = async (id: string) => {
    try {
      const ch = (await i.client.channels.fetch(id)) as unknown as Sendable;
      await ch?.send?.({ embeds: [e], allowedMentions: { parse: [] } });
    } catch (err) {
      log('moderation post failed:', (err as Error).message);
    }
  };
  if (publicCard) await to(channelId);
  if (mod.logChannelId && !(publicCard && mod.logChannelId === channelId)) await to(mod.logChannelId);
}

/** the checks shared by every command; a ready reply for the moderator when something forbids the action */
async function gate(i: ChatInputCommandInteraction | ButtonInteraction, action: PunishAction): Promise<{ title: string; text: string } | { mod: Moderation }> {
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
async function standing(guild: Guild, modId: string, target: User): Promise<string | null> {
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

const fail = (title: string, text: string) => ({ ...replyEmbed(title, text, COLORS.bad), components: [] as never[] });

export async function handlePunish(i: ChatInputCommandInteraction): Promise<void> {
  const action = i.commandName as PunishAction;
  try {
    await i.deferReply({ flags: EPHEMERAL });
    const g = await gate(i, action);
    if (!('mod' in g)) {
      await i.editReply(fail(g.title, g.text));
      return;
    }
    const guild = i.guild as Guild;
    const reason = cleanReason(i.options.getString('reason'));
    const publicCard = i.options.getBoolean('public') ?? false;
    if (action === 'unban') {
      await doUnban(i, g.mod, guild, i.options.getString('user', true), reason, publicCard);
      return;
    }
    const target = i.options.getUser('user', true);
    const why = await standing(guild, i.user.id, target);
    if (why) {
      await i.editReply(fail('Нельзя', why));
      return;
    }
    if (action === 'warn') {
      await doWarn(i, g.mod, guild, target, reason, publicCard);
      return;
    }
    // a ban and a kick wait for a button
    const days = deleteDays(i.options.getInteger('delete'));
    const token = newToken();
    pending.set(token, { action: action as 'ban' | 'kick', modId: i.user.id, targetId: target.id, reason, days, publicCard, channelId: i.channelId, at: Date.now() });
    if (pending.size > 100) for (const [k, v] of pending) if (isStale(v.at, Date.now())) pending.delete(k);
    const m = META[action];
    const e = new EmbedBuilder()
      .setColor(COLORS.warn)
      .setTitle(`${m.emoji} ${action === 'ban' ? 'Заблокировать участника?' : 'Исключить участника?'}`)
      .setDescription(action === 'ban' ? 'Участник потеряет доступ к серверу. Разблокировать можно командой `/unban`.' : 'Участник будет исключён, но сможет вернуться по новому приглашению.')
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
    log(`/${action} failed:`, (e as Error).message);
    await i.editReply(fail('Не получилось', humanDiscordError(e))).catch(() => undefined);
  }
}

export async function handlePunishButton(i: ButtonInteraction): Promise<void> {
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
    const dm = await sendDm(guild, target, job.action, job.reason);
    try {
      if (job.action === 'ban') await guild.members.ban(target.id, { reason: auditReason(i.user.username, job.reason), deleteMessageSeconds: deleteSeconds(job.days) });
      else await guild.members.kick(target.id, auditReason(i.user.username, job.reason));
    } catch (e) {
      await i.editReply(fail('Не получилось', (e as { code?: number }).code === 50013 ? 'Боту не хватает прав или его роль ниже роли участника.' : humanDiscordError(e)));
      return;
    }
    forgetBans(guild.id);
    const e = card({ action: job.action, target, mod: i.user, reason: job.reason, dm, ...(job.action === 'ban' ? { days: job.days } : {}) });
    await i.editReply({ embeds: [e], components: [] });
    await publish(i, g.mod, e, job.publicCard, job.channelId);
  } catch (e) {
    log('moderation button failed:', (e as Error).message);
    await (i.deferred || i.replied ? i.editReply(fail('Не получилось', humanDiscordError(e))) : i.update(fail('Не получилось', humanDiscordError(e)))).catch(() => undefined);
  }
}

async function doWarn(i: ChatInputCommandInteraction, mod: Moderation, guild: Guild, target: User, reason: string, publicCard: boolean): Promise<void> {
  const r = await backendJson<Warns>('/internal/warns', { method: 'POST', body: JSON.stringify({ guildId: guild.id, userId: target.id, modId: i.user.id, reason }) }).catch(() => null);
  const w = r?.ok ? r.data : null;
  const dm = await sendDm(guild, target, 'warn', reason, w?.total);
  const e = card({ action: 'warn', target, mod: i.user, reason, dm, ...(w ? { warns: { no: w.total, recent: w.recent } } : {}) });
  if (!w) e.addFields({ name: '⚠️ Счётчик', value: 'Панель не ответила: предупреждение не записано в историю.' });
  await i.editReply({ embeds: [e], components: [] });
  await publish(i, mod, e, publicCard, i.channelId);
}

async function doUnban(i: ChatInputCommandInteraction, mod: Moderation, guild: Guild, input: string, reason: string, publicCard: boolean): Promise<void> {
  const id = idFromInput(input);
  if (!id) {
    await i.editReply(fail('Не понял, кого', 'Выберите участника из списка подсказок или впишите его ID (число).'));
    return;
  }
  try {
    await guild.members.unban(id, auditReason(i.user.username, reason || 'без причины'));
  } catch (e) {
    const code = (e as { code?: number }).code;
    await i.editReply(fail('Не получилось', code === 10026 ? 'Этого человека нет в списке банов сервера.' : code === 50013 ? 'Боту не хватает права «Банить участников».' : humanDiscordError(e)));
    return;
  }
  forgetBans(guild.id);
  const target = await i.client.users.fetch(id).catch(() => null);
  const shown: User | { id: string; username: string; displayAvatarURL: () => string } = target ?? { id, username: id, displayAvatarURL: () => '' };
  const dm = target ? await sendDm(guild, target, 'unban', reason) : null;
  const e = card({ action: 'unban', target: shown as unknown as User, mod: i.user, reason, dm });
  await i.editReply({ embeds: [e], components: [] });
  await publish(i, mod, e, publicCard, i.channelId);
}

/** hints for /unban: the banned members of the server, found by name or ID */
const banCache = new Map<string, { at: number; list: { id: string; username: string }[] }>();

export async function punishAutocomplete(i: AutocompleteInteraction): Promise<void> {
  try {
    if (i.commandName !== 'unban' || !i.guild || !i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return void (await i.respond([]));
    const hit = banCache.get(i.guild.id);
    let list = hit && Date.now() - hit.at < 60_000 ? hit.list : null;
    if (!list) {
      const bans = await i.guild.bans.fetch({ limit: 1000 }).catch(() => null);
      list = bans ? [...bans.values()].map((b) => ({ id: b.user.id, username: b.user.username })) : [];
      banCache.set(i.guild.id, { at: Date.now(), list });
    }
    const q = String(i.options.getFocused()).trim().toLowerCase();
    const found = list.filter((b) => !q || b.username.toLowerCase().includes(q) || b.id.startsWith(q)).slice(0, 24).map((b) => ({ name: `${b.username} · ${b.id}`.slice(0, 100), value: b.id }));
    const typed = idFromInput(q);
    if (typed && !found.some((f) => f.value === typed)) found.push({ name: `ID ${typed}`, value: typed });
    await i.respond(found);
  } catch (e) {
    log('/unban autocomplete failed:', (e as Error).message);
    await i.respond([]).catch(() => undefined);
  }
}

/** a new ban list is read after the next ban or unban */
export const forgetBans = (guildId: string): void => void banCache.delete(guildId);
