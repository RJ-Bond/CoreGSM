/**
 * /restart: restarts a game server by a timer («/restart start time:5m», «/restart cancel»). Only for administrators of the
 * Discord server (or an administrator of the panel linked to the Discord account). The panel does the work and answers
 * with the text to show; the game chat gets «Рестарт через 5 минут» ... as the timer runs.
 */
import { PermissionFlagsBits, type ChatInputCommandInteraction, type Message } from 'discord.js';
import { backendJson } from './backend.js';
import { log } from './log.js';
import { COLORS, replyEmbed } from './replies.js';
import { cardText, channelLine, doneMark, markFor, type SayAnswer } from './gameSayLogic.js';

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
/** named game-kick: /kick is the moderation command that removes a member from the Discord server (punish.ts); Discord refuses two commands with one name */
export const KICK_COMMAND = {
  name: 'game-kick',
  description: '🚪 Кикнуть игрока с игрового сервера · только админы',
  description_localizations: { ru: '🚪 Кикнуть игрока с игрового сервера · только админы', 'en-US': '🚪 Kick a player from a game server · admins only', 'en-GB': '🚪 Kick a player from a game server · admins only' },
  dm_permission: false,
  default_member_permissions: String(PermissionFlagsBits.Administrator),
  options: [
    { type: 3, name: 'player', description: '👤 Ник игрока', description_localizations: { ru: '👤 Ник игрока', 'en-US': '👤 Nickname of the player', 'en-GB': '👤 Nickname of the player' }, required: true, max_length: 100 },
    { type: 3, name: 'reason', description: '📝 Причина (можно номер из панели)', description_localizations: { ru: '📝 Причина (можно номер из панели)', 'en-US': '📝 Reason (or a number from the panel)', 'en-GB': '📝 Reason (or a number from the panel)' }, required: false, max_length: 200 },
    SERVER,
  ],
};
RESTART_COMMANDS.push(SAY_COMMAND as never);
RESTART_COMMANDS.push(KICK_COMMAND as never);

export const RESTART_NAMES = new Set(RESTART_COMMANDS.map((c) => c.name));

export async function handleRestart(i: ChatInputCommandInteraction): Promise<void> {
  if (i.commandName === 'say') return handleSay(i);
  if (i.commandName === 'game-kick') return handleKick(i);
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** waits (up to a minute) until the plugin of the game has taken the lines; true = shown, false = not shown (expired, failed, or no answer) */
async function waitShown(ids: number[]): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const r = await backendJson<{ delivered: boolean; failed: boolean }>(`/internal/game-say-status?ids=${ids.join(',')}`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (r?.data?.delivered) return true;
    if (r?.data?.failed) return false;
  }
  return false;
}

/** the card: the line as it will look in the game, where it went and how many players are there */
function sayCard(a: SayAnswer) {
  const c = cardText(a);
  const e = replyEmbed('Отправлено в игру', c.description, COLORS.ok);
  e.embeds[0].addFields({ name: 'Куда', value: c.where.slice(0, 1000) });
  return e;
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
  const r = await backendJson<SayAnswer>('/internal/game-say', {
    method: 'POST',
    body: JSON.stringify({
      text: i.options.getString('text', true),
      server: i.options.getString('server') ?? undefined,
      name: member?.displayName ?? i.user.username,
      discordId: i.user.id,
      discordAdmin: i.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
    }),
  }).catch(() => null);
  const a = r?.data;
  if (!a) {
    await i.editReply(replyEmbed('Не получилось', 'Панель сейчас не отвечает, попробуйте ещё раз чуть позже.', COLORS.bad)).catch(() => undefined);
    return;
  }
  if (a.status !== 'sent') {
    await i.editReply(replyEmbed(a.status === 'empty' ? '📭 В игре никого нет' : 'Не получилось', a.text, COLORS.warn)).catch(() => undefined);
    return;
  }
  await i.editReply(sayCard(a)).catch((e) => log('say reply failed:', (e as Error).message));
  // the card says «shown in the game» when the plugin has taken the line
  if (a.ids?.length) {
    const shown = await waitShown(a.ids);
    const c = cardText(a);
    const e = replyEmbed(shown ? '🎮 Показано в игре' : '⚠️ Игра пока не забрала сообщение', c.description, shown ? COLORS.ok : COLORS.warn);
    e.embeds[0].addFields({ name: 'Куда', value: c.where.slice(0, 1000) });
    await i.editReply(e).catch(() => undefined);
  }
}

// ---- what an administrator writes in the channel of the game chat goes to the game
let channelCache = { at: 0, ids: new Set<string>() };

async function chatChannelIds(): Promise<Set<string>> {
  if (Date.now() - channelCache.at < 30_000) return channelCache.ids;
  const r = await backendJson<{ channels: { channelId: string }[] }>('/internal/game-chat-channels', { signal: AbortSignal.timeout(4000) }).catch(() => null);
  channelCache = { at: Date.now(), ids: new Set((r?.data?.channels ?? []).map((c) => c.channelId)) };
  return channelCache.ids;
}

/**
 * A message in a channel where the game chat is shown (the channel of the webhook, when «Писать из Discord в игру» is on):
 * the panel decides whether the writer may (administrators only) and where it goes; the bot answers with a mark under the message.
 * Messages of bots and webhooks (the chat itself) are never forwarded.
 */
export async function handleGameChatMessage(m: Message): Promise<void> {
  if (m.author.bot || m.webhookId || !m.guildId || m.system) return;
  const text = m.cleanContent.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!text || text.startsWith('/')) return;
  if (!(await chatChannelIds()).has(m.channelId)) return;
  const r = await backendJson<SayAnswer>('/internal/game-say', {
    method: 'POST',
    body: JSON.stringify({
      text, channelId: m.channelId, name: m.member?.displayName ?? m.author.username, discordId: m.author.id,
      discordAdmin: m.member?.permissions.has(PermissionFlagsBits.Administrator) ?? false,
    }),
  }).catch(() => null);
  const a = r?.data;
  if (!a || a.silent || a.status === 'denied') return;
  // at once: 👀 accepted, 📭 nobody in the game, ⏳ too often, ❌ did not work
  await m.react(markFor(a.status)).catch(() => undefined);
  if (a.status !== 'sent') return;
  const ch = m.channel;
  // the card under the message goes away by itself, the line in the style of the chat stays
  if (a.confirm?.card && 'send' in ch) {
    void m.reply({ ...sayCard(a), allowedMentions: { parse: [], repliedUser: false } })
      .then((c) => sleep(12_000).then(() => c.delete()))
      .catch(() => undefined);
  }
  if (a.confirm?.line && a.ansi && 'send' in ch) {
    void ch.send({ content: channelLine(a.ansi), allowedMentions: { parse: [] } }).catch(() => undefined);
  }
  // 👀 becomes 🎮 when the game has shown the line
  if (a.ids?.length) {
    const shown = await waitShown(a.ids);
    const mine = m.reactions.cache.get('👀');
    await mine?.users.remove(m.client.user?.id).catch(() => undefined);
    await m.react(doneMark(shown)).catch(() => undefined);
  }
}

/** /kick: the panel gives the command to the plugin of the server, which finds the player by the nickname and does it the usual way (the rules, the lines and the log are those of .kick) */
async function handleKick(i: ChatInputCommandInteraction): Promise<void> {
  try {
    await i.deferReply({ flags: EPHEMERAL });
  } catch (e) {
    log('kick: could not acknowledge:', (e as Error).message);
    return;
  }
  const member = i.member as { displayName?: string } | null;
  const player = i.options.getString('player', true);
  const r = await backendJson<{ ok: boolean; ids?: number[]; text: string }>('/internal/game-kick', {
    method: 'POST',
    body: JSON.stringify({
      name: player,
      reason: i.options.getString('reason') ?? undefined,
      server: i.options.getString('server') ?? undefined,
      adminName: member?.displayName ?? i.user.username,
      discordId: i.user.id,
      discordAdmin: i.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
    }),
  }).catch(() => null);
  const a = r?.data;
  if (!a) {
    await i.editReply(replyEmbed('Не получилось', 'Панель сейчас не отвечает, попробуйте ещё раз чуть позже.', COLORS.bad)).catch(() => undefined);
    return;
  }
  if (!a.ok || !a.ids?.length) {
    await i.editReply(replyEmbed('Не получилось', a.text, COLORS.warn)).catch(() => undefined);
    return;
  }
  await i.editReply(replyEmbed('🚪 Команда отправлена', `Ищу игрока **${player.replace(/[*_`~|>]/g, '')}** на сервере…`, COLORS.info)).catch(() => undefined);
  // the plugin takes the command with its next poll (a few seconds) and reports what it did
  for (let n = 0; n < 12; n++) {
    await sleep(2500);
    const st = await backendJson<{ done: boolean; failed: boolean; text: string }>(`/internal/game-command-status?ids=${a.ids.join(',')}`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (st?.data?.done) {
      await i.editReply(replyEmbed('🚪 Игрок кикнут', st.data.text || 'Готово.', COLORS.ok)).catch(() => undefined);
      return;
    }
    if (st?.data?.failed) {
      await i.editReply(replyEmbed('Не получилось', st.data.text || 'Игрок не найден.', COLORS.warn)).catch(() => undefined);
      return;
    }
  }
  await i.editReply(replyEmbed('⚠️ Нет ответа от игры', 'Плагин не ответил за полминуты: проверьте, что сервер запущен и плагин на связи.', COLORS.warn)).catch(() => undefined);
}
