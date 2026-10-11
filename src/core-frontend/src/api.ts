const KEY = 'coregsm_token';

export const getToken = () => {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
};
export const setToken = (t: string) => {
  try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ignore */ }
};

export interface Server {
  id: number;
  /** shown title: custom name > name reported by the game server > host:port */
  name: string;
  /** the name typed by the user ('' = taken automatically from the server's reply) */
  customName: string;
  nameAuto: boolean;
  game: string;
  host: string;
  port: number;
  queryPort: number | null;
  /** what people see instead of host:port ('' = not set) */
  displayAddress: string;
  /** the address shown in the panel and on cards */
  address: string;
  hasStatus: boolean;
  online: boolean;
  players: number;
  maxPlayers: number;
  map: string | null;
  version: string | null;
  ping: number | null;
  playerNames: string[];
  error: string | null;
  updatedAt: number | null;
}

export interface Binding {
  id: number;
  serverId: number;
  channelId: string;
  /** resolved by the bot when it can see the channel */
  channelName: string | null;
  guildName: string | null;
  messageId: string | null;
  intervalSec: number;
  enabled: boolean;
  /** how the message looks in Discord */
  style: 'embed' | 'card' | 'both';
  lastUpdate: number | null;
  lastError: string | null;
}

export interface ServerInput {
  name: string;
  game: string;
  host: string;
  port: number;
  queryPort: number | null;
  displayAddress: string;
}

export class ApiError extends Error {}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') {
    setToken('');
    window.dispatchEvent(new Event('coregsm:logout'));
  }
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Ошибка ${res.status}`);
  return data as T;
}

export interface SettingsInfo {
  discordTokenSet: boolean;
  discordTokenHint: string | null;
  proxyUrl: string | null;
}

export interface BotStatus {
  state: 'idle' | 'connecting' | 'online' | 'error';
  tag: string | null;
  clientId: string | null;
  inviteUrl: string | null;
  /** Discord servers the bot is on, and text channels it can post in */
  guildCount?: number;
  channelCount?: number;
  error: string | null;
  updatedAt: number;
}

export interface UpdateInfo {
  current: string | null;
  latest: string | null;
  available: boolean;
  checkedAt: number | null;
  error: string | null;
  canApply: boolean;
  pending: boolean;
  job: { state: 'running' | 'done' | 'error'; message: string; time: number } | null;
}

export interface TestResult {
  online: boolean;
  name: string | null;
  players: number;
  maxPlayers: number;
  map: string | null;
  version: string | null;
  ping: number | null;
  playerNames: string[];
  error: string | null;
}

export interface ServerDetails {
  server: Server;
  hours: number;
  points: { ts: number; players: number; online: number }[];
  stats: { samples: number; uptimePct: number | null; avgPlayers: number | null; peakPlayers: number | null; peakAt: number | null };
  events: { ts: number; type: 'up' | 'down' }[];
}

export interface DiscordGuild {
  id: string;
  name: string;
  /** text channels the bot can see but not write to */
  hidden?: number;
  channels: { id: string; name: string; missing?: string[] }[];
}

// ---------- news ----------
export interface NewsEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  author?: { name: string; iconUrl?: string };
  thumbnailUrl?: string;
  image?: { url?: string; upload?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: boolean;
}

export interface NewsPayload {
  content: string;
  mention: 'none' | 'here' | 'everyone';
  embed?: NewsEmbed;
}

export type NewsStatus = 'draft' | 'scheduled' | 'queued' | 'sending' | 'sent' | 'error' | 'edit_queued' | 'delete_queued';

export interface NewsItem {
  id: number;
  status: NewsStatus;
  title: string;
  channelId: string;
  channelName: string | null;
  guildName: string | null;
  /** opens the posted message in Discord */
  messageUrl: string | null;
  payload: NewsPayload;
  scheduledAt: number | null;
  sentAt: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewsSettings {
  channelId: string | null;
  channelName?: string | null;
  guildName?: string | null;
}
