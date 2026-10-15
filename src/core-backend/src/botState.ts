/** What the bot reports about itself: connection state and the Discord servers and channels it can post in. */
import { getSetting } from './db.js';

export interface BotStatus {
  state: 'idle' | 'connecting' | 'online' | 'error';
  tag: string | null;
  clientId: string | null;
  error: string | null;
  commands: number | null;
  updatedAt: number;
}

// guilds and text channels the bot can post in (reported by the bot, used for the channel picker)
export interface BotGuild {
  id: string;
  name: string;
  /** text channels the bot can see but not write to */
  hidden?: number;
  channels: { id: string; name: string; missing?: string[] }[];
  /** roles the bot can give (below its own role, not managed by an integration) */
  roles?: { id: string; name: string; color: number }[];
  /** voice channels the bot can rename (live counters) */
  voice?: { id: string; name: string }[];
}

// persisted, so a backend restart does not leave the channel picker empty until the bot reports again
function loadGuilds(): BotGuild[] {
  try {
    const v = JSON.parse(getSetting('bot_guilds') ?? '[]');
    return Array.isArray(v) ? (v as BotGuild[]) : [];
  } catch {
    return [];
  }
}

/** replaced as a whole by the bot's reports (POST /internal/bot-status, /internal/bot-guilds) */
export const bot: { status: BotStatus; guilds: BotGuild[] } = {
  status: { state: 'idle', tag: null, clientId: null, error: null, commands: null, updatedAt: 0 },
  guilds: loadGuilds(),
};

export function channelInfo(channelId: string): { channelName: string | null; guildName: string | null; guildId: string | null } {
  for (const g of bot.guilds) {
    const c = g.channels.find((x) => x.id === channelId);
    if (c) return { channelName: c.name, guildName: g.name, guildId: g.id };
  }
  return { channelName: null, guildName: null, guildId: null };
}

// View Channel + Send Messages + Embed Links + Attach Files + Manage Channels (counters) + Manage Roles (autoroles)
const BOT_PERMISSIONS = 52224 + 16 + 268435456;

/** The first segment of a bot token is the base64 of the bot user id (= application id). */
export function clientIdFromToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const id = Buffer.from(token.split('.')[0], 'base64').toString('utf8');
    return /^\d{15,25}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** the application id: from the running bot, else from the saved token */
export const botClientId = () => bot.status.clientId ?? clientIdFromToken(getSetting('discord_token'));

/** slash commands of the bot (the bot registers the same set; shown in the panel) */
export const BOT_COMMANDS = [
  { name: '/register', description: 'Зарегистрироваться на сайте через Discord (пароль не нужен). Параметры: nick (ник в игре), agree (согласие с правилами)' },
  { name: '/nick', description: 'Сменить игровой ник, по которому считается статистика' },
  { name: '/profile', description: 'Моя карточка: ник, ранг V Rising, часы в игре и достижения' },
  { name: '/online', description: 'Кто сейчас играет: онлайн всех серверов' },
  { name: '/status', description: 'Карточка сервера с графиком за сутки. Параметр: server' },
  { name: '/player', description: 'Карточка игрока: часы, серия дней, где и когда играет. Параметр: nick' },
  { name: '/top', description: 'Самые активные игроки недели или месяца' },
];

export function invitePayload() {
  const clientId = botClientId();
  return {
    clientId,
    inviteUrl: clientId ? `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=${BOT_PERMISSIONS}` : null,
  };
}

export const discordLoginReady = () => !!getSetting('discord_client_secret') && !!botClientId();
