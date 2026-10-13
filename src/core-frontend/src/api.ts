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
  /** country shown in Discord ('' = detected automatically) */
  country: string;
  /** "/api/covers/<id>.jpg?v=..." when an administrator uploaded a cover picture */
  coverUrl: string | null;
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
  /** every server shown in the message: the main one first, then the extras */
  serverIds: number[];
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
  /** ISO country code shown in Discord; '' = detect automatically */
  country: string;
}

/** an error answer from the API; `data` is the whole JSON body (retryAfter, attemptsLeft, pending ...) */
export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status = 0, data: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

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
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Ошибка ${res.status}`, res.status, data as Record<string, unknown>);
  return data as T;
}

export interface SettingsInfo {
  discordTokenSet: boolean;
  discordTokenHint: string | null;
  proxyUrl: string | null;
  /** "Вход через Discord" (OAuth2) */
  discordSecretSet?: boolean;
  discordClientId?: string | null;
  discordRedirect?: string;
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
  /** a previous version and a database copy exist, so the update can be undone */
  canRollback: boolean;
  pending: boolean;
  job: { state: 'running' | 'done' | 'error'; message: string; time: number; /** 0..100, absent on older managers */ progress?: number } | null;
}

export interface ChangelogItem {
  sha: string;
  title: string;
  /** commit time, ms (older servers may send an ISO string) */
  date: number | string | null;
  url: string;
}

export interface Changelog {
  items: ChangelogItem[];
  error?: string;
}

// ---------- public status page ----------
export interface StatusDay {
  /** YYYY-MM-DD */
  day: string;
  /** null = no data */
  pct: number | null;
}

export interface StatusServer {
  id: number;
  name: string;
  game: string;
  address: string;
  coverUrl?: string | null;
  online: boolean;
  players: number;
  maxPlayers: number;
  uptime30: number | null;
  /** 30 entries, oldest first */
  days: StatusDay[];
  avgPing: number | null;
}

export interface StatusInfo {
  updatedAt: number;
  servers: StatusServer[];
}

// ---------- backups ----------
export interface BackupItem {
  name: string;
  size: number;
  createdAt: number;
  kind: 'auto' | 'manual';
}

export interface BackupInfo {
  schedule: 'off' | 'daily' | 'weekly';
  keep: number;
  /** masked */
  remoteUrl: string | null;
  encrypted: boolean;
  items: BackupItem[];
  lastRemote: { at: number; ok: boolean; error: string | null } | null;
}

export interface CertInfo {
  daysLeft: number | null;
  /** ms */
  notAfter: number | null;
  issuer: string | null;
  selfSigned: boolean;
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
  /** `countryCode`: two-letter ISO code or '' */
  server: Server & { countryCode?: string };
  hours: number;
  /** `ping`: ms, null when unknown (or the server did not answer) */
  points: { ts: number; players: number; online: number; ping: number | null }[];
  stats: { samples: number; uptimePct: number | null; avgPlayers: number | null; peakPlayers: number | null; peakAt: number | null };
  /** newest first; `players` is set for 'peak' */
  events: { ts: number; type: 'up' | 'down' | 'peak'; players: number | null }[];
  /** players with the time they joined (empty when the game gives no names) */
  playersNow: PlayerNow[];
}

export interface PlayerNow {
  name: string;
  /** ms: when the player joined */
  since: number;
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

export type Embed = NewsEmbed;

export interface NewsPayload {
  content: string;
  mention: 'none' | 'here' | 'everyone';
  embed?: NewsEmbed;
  /** further embeds of the same message (Discord allows 10 in total with `embed`) */
  extraEmbeds?: Embed[];
  /** live status block: up to 5 servers, refreshed by the bot when the message is sent */
  statusServerIds?: number[];
}

/** GET /news/variables */
export interface NewsVariable {
  token: string;
  description: string;
}

/** GET /news/:id/versions */
export interface NewsVersion {
  id: number | string;
  ts: number;
  actor: string;
  note?: string | null;
}

/** GET /news/:id/versions/:vid */
export interface NewsVersionFull {
  id: number | string;
  ts: number;
  actor: string;
  payload: NewsPayload;
}

/** GET /news/:id/history */
export interface NewsHistoryEntry {
  ts: number;
  actor: string;
  action: string;
}

/** GET /news/autosave?key= (null / empty when there is nothing) */
export interface NewsAutosave {
  payload?: NewsPayload | null;
  channelId?: string | null;
  ts?: number | null;
  updatedAt?: number | null;
}

/** POST /news/test, then poll GET /news/test/:id */
export interface NewsTestResult {
  ok: boolean;
  testId: number | string;
}
export interface NewsTestStatus {
  status: 'pending' | 'sent' | 'error';
  error?: string | null;
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
  /** a scheduled item can repeat: the next one is scheduled after each post */
  repeat: 'none' | 'daily' | 'weekly' | 'monthly';
  sentAt: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewsSettings {
  channelId: string | null;
  channelName?: string | null;
  guildName?: string | null;
  /** where "Отправить тест" posts */
  testChannelId?: string | null;
  testChannelName?: string | null;
  testGuildName?: string | null;
}

// ---------- accounts and access ----------
export interface Me {
  username: string;
  role: 'admin' | 'moderator' | 'player';
  /** Discord CDN url */
  avatarUrl: string | null;
  /** where the picture comes from: an uploaded file wins over Discord */
  avatarSource: 'custom' | 'discord' | null;
  discordName: string | null;
  hasPassword: boolean;
  email?: string | null;
}

export interface Session {
  id: string | number;
  createdAt: number;
  lastSeen: number;
  ip: string;
  ua: string;
  current: boolean;
}

export interface Brand {
  name: string;
  color: string;
  /** optional second (end) colour of the gradients; '' = derived automatically */
  color2?: string;
  /** id of the chosen theme preset ('' = custom colour) */
  preset?: string;
  hasLogo: boolean;
  logoV: number;
}

export interface Access {
  brand: Brand;
  /** the server list and news are visible without signing in */
  publicPanel: boolean;
  /** players may create accounts */
  registration: boolean;
  /** open: account at once; approval: an administrator must approve it */
  registrationMode: 'open' | 'approval';
  /** community rules ('' = none) */
  rules: string;
  /** "Войти через Discord" is configured */
  discordLogin: boolean;
}

export interface UserRow {
  id: number;
  username: string;
  role: 'admin' | 'moderator' | 'player';
  createdAt: number | null;
  status: 'active' | 'pending';
  discordName: string | null;
}

/** what guests and players get for a posted news item */
export interface PublicNews {
  id: number;
  status: NewsStatus;
  title: string;
  payload: NewsPayload;
  sentAt: number | null;
}
