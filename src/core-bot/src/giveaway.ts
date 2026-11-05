/** /giveaway start|end|reroll (administrators) and the «🎉 Участвую» button under a giveaway. The backend keeps the entries and draws. */
import { EmbedBuilder, PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { backendJson } from './backend.js';
import { mayEdit, withParticipants } from './giveawayLogic.js';
import { log } from './log.js';
import { COLORS, replyEmbed } from './replies.js';

const EPHEMERAL = 64;
const loc = (ru: string, en: string) => ({ ru, 'en-US': en, 'en-GB': en });
const idOpt = { type: 4, name: 'id', description: 'Номер розыгрыша', description_localizations: loc('Номер розыгрыша', 'Giveaway number'), required: true, min_value: 1 };

export const GIVEAWAY_COMMANDS = [
  {
    name: 'giveaway',
    description: '🎉 Розыгрыш призов · только админы',
    description_localizations: loc('🎉 Розыгрыш призов · только админы', '🎉 Prize giveaway · admins only'),
    dm_permission: false,
    default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: [
      {
        type: 1,
        name: 'start',
        description: 'Начать розыгрыш в этом канале',
        description_localizations: loc('Начать розыгрыш в этом канале', 'Start a giveaway in this channel'),
        options: [
          { type: 3, name: 'prize', description: 'Приз', description_localizations: loc('Приз', 'Prize'), required: true, max_length: 200 },
          { type: 10, name: 'hours', description: 'Через сколько часов подвести итоги', description_localizations: loc('Через сколько часов подвести итоги', 'Hours until the draw'), required: true, min_value: 0.05, max_value: 720 },
          { type: 4, name: 'winners', description: 'Сколько победителей (по умолчанию 1)', description_localizations: loc('Сколько победителей (по умолчанию 1)', 'How many winners (1 by default)'), min_value: 1, max_value: 20 },
          { type: 8, name: 'role', description: 'Участвовать могут только с этой ролью', description_localizations: loc('Участвовать могут только с этой ролью', 'Only members with this role may join') },
          { type: 10, name: 'min_hours', description: 'Минимум часов игры (нужен привязанный ник)', description_localizations: loc('Минимум часов игры (нужен привязанный ник)', 'Minimum hours of play (a linked nick is needed)'), min_value: 0, max_value: 100000 },
        ],
      },
      { type: 1, name: 'end', description: 'Подвести итоги сейчас', description_localizations: loc('Подвести итоги сейчас', 'Draw now'), options: [idOpt] },
      { type: 1, name: 'reroll', description: 'Выбрать новых победителей вместо прежних', description_localizations: loc('Выбрать новых победителей вместо прежних', 'Pick new winners instead of the old ones'), options: [idOpt] },
    ],
  },
];
export const GIVEAWAY_NAMES = new Set(GIVEAWAY_COMMANDS.map((c) => c.name));

export async function handleGiveaway(i: ChatInputCommandInteraction): Promise<void> {
  if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await i.reply({ embeds: [replyEmbed('Только для администраторов', 'Розыгрышами управляют администраторы сервера.', COLORS.warn)], flags: EPHEMERAL }).catch(() => undefined);
    return;
  }
  try {
    await i.deferReply({ flags: EPHEMERAL });
  } catch (e) {
    log('giveaway: could not acknowledge:', (e as Error).message);
    return;
  }
  const sub = i.options.getSubcommand();
  let out;
  if (sub === 'start') {
    const r = await backendJson<{ id?: number; error?: string }>('/internal/giveaways/start', {
      method: 'POST',
      body: JSON.stringify({
        prize: i.options.getString('prize', true),
        hours: i.options.getNumber('hours', true),
        winners: i.options.getInteger('winners') ?? 1,
        roleId: i.options.getRole('role')?.id ?? '',
        minHours: i.options.getNumber('min_hours') ?? 0,
        channelId: i.channelId,
        hostId: i.user.id,
      }),
    }).catch(() => null);
    out = r?.ok ? replyEmbed('Розыгрыш запущен', `Номер **${r.data?.id}**. Карточка появится в канале через несколько секунд. Итоги подведутся сами; раньше — \`/giveaway end id:${r.data?.id}\`.`, COLORS.ok)
      : replyEmbed('Не получилось', r?.data?.error ?? 'Панель сейчас не отвечает, попробуйте ещё раз чуть позже.', COLORS.bad);
  } else {
    const r = await backendJson<{ status?: string; winners?: string[] }>('/internal/giveaways/end', { method: 'POST', body: JSON.stringify({ id: i.options.getInteger('id', true), reroll: sub === 'reroll' }) }).catch(() => null);
    const s = r?.data?.status;
    out = s === 'ok' ? replyEmbed(sub === 'reroll' ? 'Новые победители выбраны' : 'Итоги подведены', 'Результат появится в канале розыгрыша.', COLORS.ok)
      : s === 'notfound' ? replyEmbed('Розыгрыш не найден', 'Проверьте номер на карточке розыгрыша.', COLORS.bad)
      : s === 'ended' ? replyEmbed('Уже подведено', 'Чтобы выбрать других победителей, используйте `/giveaway reroll`.', COLORS.warn)
      : s === 'running' ? replyEmbed('Розыгрыш ещё идёт', 'Сначала подведите итоги: `/giveaway end`.', COLORS.warn)
      : replyEmbed('Не получилось', 'Панель сейчас не отвечает, попробуйте ещё раз чуть позже.', COLORS.bad);
  }
  await i.editReply(out).catch((e) => log('giveaway reply failed:', (e as Error).message));
}

const lastEdit = new Map<string, number>();

/** the «🎉 Участвую» button: «gw:<id>» */
export async function handleGiveawayButton(i: ButtonInteraction): Promise<void> {
  const m = /^gw:(\d+)$/.exec(i.customId);
  if (!m) return;
  try {
    await i.deferReply({ flags: EPHEMERAL });
  } catch (e) {
    log('giveaway button: could not acknowledge:', (e as Error).message);
    return;
  }
  const roles = Array.isArray(i.member?.roles) ? (i.member.roles as string[]) : [...(i.member?.roles?.cache?.keys() ?? [])];
  const r = await backendJson<{ status?: string; roleId?: string; minHours?: number; hours?: number | null; total?: number }>('/internal/giveaways/join', {
    method: 'POST',
    body: JSON.stringify({ id: Number(m[1]), discordId: i.user.id, roles }),
  }).catch(() => null);
  const d = r?.data;
  const out =
    d?.status === 'ok' ? replyEmbed('Вы участвуете', `Удачи! Участников: ${d.total}.`, COLORS.ok)
    : d?.status === 'already' ? replyEmbed('Вы уже участвуете', 'Повторно нажимать не нужно.', COLORS.ok)
    : d?.status === 'role' ? replyEmbed('Нужна роль', `Участвовать могут только участники с ролью <@&${d.roleId}>.`, COLORS.warn)
    : d?.status === 'unlinked' ? replyEmbed('Нужен привязанный ник', `Нужно от ${d.minHours} ч игры, а ник не привязан: сделайте это командой /link.`, COLORS.warn)
    : d?.status === 'hours' ? replyEmbed('Пока не хватает часов', `Нужно от ${d.minHours} ч игры, у вас ${(d.hours ?? 0).toFixed(1)} ч.`, COLORS.warn)
    : d?.status === 'ended' ? replyEmbed('Розыгрыш завершён', 'Приём участников закончился.', COLORS.warn)
    : d?.status === 'notfound' ? replyEmbed('Розыгрыш не найден', 'Возможно, его удалили.', COLORS.bad)
    : replyEmbed('Не получилось', 'Панель сейчас не отвечает, попробуйте ещё раз чуть позже.', COLORS.bad);
  await i.editReply(out).catch((e) => log('giveaway reply failed:', (e as Error).message));
  // the card shows how many people take part
  if ((d?.status === 'ok' || d?.status === 'already') && typeof d.total === 'number' && i.message.embeds[0] && mayEdit(lastEdit, i.message.id, Date.now())) {
    const e = EmbedBuilder.from(i.message.embeds[0]).setDescription(withParticipants(i.message.embeds[0].description ?? '', d.total));
    await i.message.edit({ embeds: [e] }).catch((err) => log('giveaway card update failed:', (err as Error).message));
  }
}
