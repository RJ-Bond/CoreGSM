/**
 * /restart: restarts a game server by a timer («/restart start time:5m», «/restart cancel»). Only for administrators of the
 * Discord server (or an administrator of the panel linked to the Discord account). The panel does the work and answers
 * with the text to show; the game chat gets «Рестарт через 5 минут» ... as the timer runs.
 */
import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { backendJson } from './backend.js';
import { log } from './log.js';
import { COLORS, replyEmbed } from './replies.js';

const EPHEMERAL = 64;
const SERVER = { type: 3, name: 'server', description: '🎮 Сервер (если их несколько)', description_localizations: { ru: '🎮 Сервер (если их несколько)', 'en-US': '🎮 Server (when there are several)', 'en-GB': '🎮 Server (when there are several)' }, required: false };

export const RESTART_COMMANDS = [
  {
    name: 'restart',
    description: '♻️ Рестарт игрового сервера по таймеру · только админы',
    description_localizations: { ru: '♻️ Рестарт игрового сервера по таймеру · только админы', 'en-US': '♻️ Restart a game server by a timer · admins only', 'en-GB': '♻️ Restart a game server by a timer · admins only' },
    dm_permission: false,
    default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: [
      {
        type: 1, name: 'start', description: '⏱ Запустить таймер', description_localizations: { ru: '⏱ Запустить таймер', 'en-US': '⏱ Start the timer', 'en-GB': '⏱ Start the timer' },
        options: [{ type: 3, name: 'time', description: '⏳ Через сколько: 5m, 30s, 1h', description_localizations: { ru: '⏳ Через сколько: 5m, 30s, 1h', 'en-US': '⏳ In how long: 5m, 30s, 1h', 'en-GB': '⏳ In how long: 5m, 30s, 1h' }, required: true, max_length: 20 }, SERVER],
      },
      { type: 1, name: 'cancel', description: '🛑 Отменить рестарт', description_localizations: { ru: '🛑 Отменить рестарт', 'en-US': '🛑 Cancel the restart', 'en-GB': '🛑 Cancel the restart' }, options: [SERVER] },
      { type: 1, name: 'status', description: 'ℹ️ Сколько осталось', description_localizations: { ru: 'ℹ️ Сколько осталось', 'en-US': 'ℹ️ Time left', 'en-GB': 'ℹ️ Time left' }, options: [SERVER] },
    ],
  },
];
export const SAY_COMMAND = {
  name: 'say',
  description: '💬 Написать в игровой чат сервера · только админы',
  description_localizations: { ru: '💬 Написать в игровой чат сервера · только админы', 'en-US': '💬 Write to the game chat of a server · admins only', 'en-GB': '💬 Write to the game chat of a server · admins only' },
  dm_permission: false,
  default_member_permissions: String(PermissionFlagsBits.Administrator),
  options: [
    { type: 3, name: 'text', description: '✍️ Что написать', description_localizations: { ru: '✍️ Что написать', 'en-US': '✍️ What to write', 'en-GB': '✍️ What to write' }, required: true, max_length: 250 },
    SERVER,
  ],
};
RESTART_COMMANDS.push(SAY_COMMAND as never);

export const RESTART_NAMES = new Set(RESTART_COMMANDS.map((c) => c.name));

export async function handleRestart(i: ChatInputCommandInteraction): Promise<void> {
  if (i.commandName === 'say') return handleSay(i);
  try {
    await i.deferReply({ flags: EPHEMERAL });
  } catch (e) {
    log('restart: could not acknowledge:', (e as Error).message);
    return;
  }
  const action = i.options.getSubcommand() as 'start' | 'cancel' | 'status';
  const r = await backendJson<{ ok: boolean; text: string }>('/internal/game-restart', {
    method: 'POST',
    body: JSON.stringify({
      action,
      time: action === 'start' ? i.options.getString('time', true) : undefined,
      server: i.options.getString('server') ?? undefined,
      discordId: i.user.id,
      discordAdmin: i.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
    }),
  }).catch(() => null);
  const out = r?.data
    ? replyEmbed(r.data.ok ? 'Рестарт' : 'Не получилось', r.data.text, r.data.ok ? COLORS.ok : COLORS.warn)
    : replyEmbed('Не получилось', 'Панель сейчас не отвечает, попробуйте ещё раз чуть позже.', COLORS.bad);
  await i.editReply(out).catch((e) => log('restart reply failed:', (e as Error).message));
}

/** /say: a line from Discord into the game chat («* [Discord] Имя: текст») of one server or of all that have the plugin */
async function handleSay(i: ChatInputCommandInteraction): Promise<void> {
  try {
    await i.deferReply({ flags: EPHEMERAL });
  } catch (e) {
    log('say: could not acknowledge:', (e as Error).message);
    return;
  }
  const member = i.member as { displayName?: string } | null;
  const r = await backendJson<{ ok: boolean; text: string }>('/internal/game-say', {
    method: 'POST',
    body: JSON.stringify({
      text: i.options.getString('text', true),
      server: i.options.getString('server') ?? undefined,
      name: member?.displayName ?? i.user.username,
      discordId: i.user.id,
      discordAdmin: i.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
    }),
  }).catch(() => null);
  const out = r?.data
    ? replyEmbed(r.data.ok ? 'В игру' : 'Не получилось', r.data.text, r.data.ok ? COLORS.ok : COLORS.warn)
    : replyEmbed('Не получилось', 'Панель сейчас не отвечает, попробуйте ещё раз чуть позже.', COLORS.bad);
  await i.editReply(out).catch((e) => log('say reply failed:', (e as Error).message));
}
