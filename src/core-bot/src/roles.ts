/**
 * Roles a member takes by himself: a menu under the welcome message and the /roles command.
 *
 * The administrator chooses the roles in the panel; the bot checks them again each time, because a role can change after
 * it was chosen: it is handed out only when it is not managed by an integration, the bot can edit it, and it carries no
 * administrative permission (so a menu can never make anybody a moderator).
 */
import { ActionRowBuilder, EmbedBuilder, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, type ChatInputCommandInteraction, type Guild, type Role, type StringSelectMenuInteraction } from 'discord.js';
import { backendJson } from './backend.js';
import { humanDiscordError } from './errors.js';
import { log } from './log.js';
import { COLORS, replyEmbed } from './replies.js';
import { footerOf, getStyle } from './style.js';

export const ROLE_COMMANDS = [{ name: 'roles', description: 'Выбрать себе роли в меню: можно взять и снять', dm_permission: false }];
export const ROLE_NAMES = new Set(ROLE_COMMANDS.map((c) => c.name));

/** the menu under the greeting only adds roles; the menu of /roles sets the whole choice (adds and removes) */
export const MENU_WELCOME = 'roles:welcome';
export const MENU_SET = 'roles:set';
/** Discord allows 25 options in a menu */
export const MAX_OPTIONS = 25;

const EPHEMERAL = 64;

/** a role with any of these is never handed out by a menu */
export const DANGEROUS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageGuildExpressions,
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
];

interface RoleLike {
  id: string;
  managed: boolean;
  editable: boolean;
  permissions: { any: (bits: bigint[]) => boolean };
}

/** true when the role may be given by a menu */
export const isPickable = (r: RoleLike, guildId: string): boolean => r.id !== guildId && !r.managed && r.editable && !r.permissions.any(DANGEROUS);

/** the chosen roles that still exist in this server and are safe, the highest first */
export function pickableRoles(guild: Guild, ids: string[]) {
  return [...new Set(ids)]
    .map((id) => guild.roles.cache.get(id))
    .filter((r): r is Role => !!r && isPickable(r, guild.id))
    .sort((a, b) => b.position - a.position)
    .slice(0, MAX_OPTIONS);
}

type RoleOption = { id: string; name: string; unicodeEmoji: string | null };

/** the drop-down: `min` 1 for the greeting (it only adds), 0 for /roles (an empty choice removes everything) */
export function roleMenu(customId: string, roles: RoleOption[], have: Set<string>, min: 0 | 1) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(min ? '🎭 Выберите роли' : '🎭 Ваши роли: отметьте нужные')
    .setMinValues(min)
    .setMaxValues(Math.max(1, roles.length))
    .addOptions(
      roles.map((r) => {
        const o = new StringSelectMenuOptionBuilder().setLabel(r.name.slice(0, 100) || r.id).setValue(r.id).setDefault(have.has(r.id));
        // a role icon that is an ordinary emoji is shown in front of the name
        return r.unicodeEmoji ? o.setEmoji(r.unicodeEmoji) : o;
      }),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/** the menu under the welcome message, or null when no safe role was chosen */
export function welcomeRoleRow(guild: Guild, ids: string[]) {
  const roles = pickableRoles(guild, ids);
  return roles.length ? roleMenu(MENU_WELCOME, roles, new Set(), 1) : null;
}

async function allowedIds(): Promise<string[]> {
  const r = await backendJson<{ roles?: unknown }>('/internal/roles/options').catch(() => null);
  const list = r?.data?.roles;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && /^\d{15,25}$/.test(x)) : [];
}

const mentions = (ids: string[]) => ids.map((id) => `<@&${id}>`).join(' ');

export async function handleRolesCommand(i: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!i.guild) {
      await i.reply({ ...replyEmbed('Только на сервере', 'Команда работает на Discord-сервере, а не в личных сообщениях.', COLORS.warn), flags: EPHEMERAL });
      return;
    }
    await i.deferReply({ flags: EPHEMERAL });
    const roles = pickableRoles(i.guild, await allowedIds());
    if (!roles.length) {
      await i.editReply(replyEmbed('Ролей пока нет', 'Администратор ещё не выбрал роли, которые можно брать самому.', COLORS.warn));
      return;
    }
    const member = await i.guild.members.fetch(i.user.id);
    const e = new EmbedBuilder()
      .setColor(getStyle().accent)
      .setTitle('🎭 Выбор ролей')
      .setDescription('Отметьте роли, которые хотите иметь, в меню ниже. Снимите отметку, и роль уберётся.')
      .addFields({ name: 'Доступные роли', value: mentions(roles.map((r) => r.id)).slice(0, 1000) })
      .setFooter(footerOf());
    await i.editReply({ embeds: [e], components: [roleMenu(MENU_SET, roles, new Set(member.roles.cache.keys()), 0)] });
  } catch (e) {
    log('/roles failed:', (e as Error).message);
    await i.editReply(replyEmbed('Не получилось', humanDiscordError(e), COLORS.bad)).catch(() => undefined);
  }
}

/** a choice in one of the two menus */
export async function handleRoleSelect(i: StringSelectMenuInteraction): Promise<void> {
  const set = i.customId === MENU_SET;
  if (!set && i.customId !== MENU_WELCOME) return;
  try {
    if (!i.guild) return;
    // the set menu lives in the private message of /roles and is updated in place; the greeting menu is public: answer privately
    if (set) await i.deferUpdate();
    else await i.deferReply({ flags: EPHEMERAL });
    const roles = pickableRoles(i.guild, await allowedIds());
    const allowed = new Set(roles.map((r) => r.id));
    const chosen = new Set(i.values.filter((v) => allowed.has(v)));
    const member = await i.guild.members.fetch(i.user.id);
    const have = new Set(member.roles.cache.keys());
    const add = [...chosen].filter((id) => !have.has(id));
    const remove = set ? roles.filter((r) => have.has(r.id) && !chosen.has(r.id)).map((r) => r.id) : [];
    if (add.length) await member.roles.add(add, 'CoreGSM: выбор ролей');
    if (remove.length) await member.roles.remove(remove, 'CoreGSM: выбор ролей');
    const now = new Set([...have, ...add].filter((id) => !remove.includes(id)));
    const e = new EmbedBuilder().setColor(add.length || remove.length ? COLORS.ok : getStyle().accent).setFooter(footerOf());
    if (!add.length && !remove.length) {
      e.setTitle('Ничего не изменилось').setDescription(set ? 'Выбранные роли у вас уже есть.' : 'Эти роли у вас уже есть. Убрать роль можно командой `/roles`.');
    } else {
      e.setTitle('✅ Роли обновлены');
      if (add.length) e.addFields({ name: 'Добавлено', value: mentions(add).slice(0, 1000) });
      if (remove.length) e.addFields({ name: 'Убрано', value: mentions(remove).slice(0, 1000) });
      if (!set) e.setDescription('Убрать роль можно командой `/roles`.');
    }
    if (set) await i.editReply({ embeds: [e], components: [roleMenu(MENU_SET, roles, now, 0)] });
    else await i.editReply({ embeds: [e] });
  } catch (e) {
    log(`roles menu ${i.customId} failed:`, (e as Error).message);
    const out = replyEmbed('Не получилось', humanDiscordError(e), COLORS.bad);
    await (i.deferred || i.replied ? i.editReply({ ...out, components: [] }) : i.reply({ ...out, flags: EPHEMERAL })).catch(() => undefined);
  }
}
