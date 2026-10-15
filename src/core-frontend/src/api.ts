/**
 * Session handling. The session lives in an HttpOnly cookie (coregsm_session) that the server sets on sign-in; the page
 * never sees the token, so it cannot be stolen by a script. What is kept locally is only a hint (below) so that guests
 * do not probe /api/me on every start.
 *
 * getToken() is still used by older code that builds `Authorization: Bearer ...` itself: it returns the token held in
 * memory (legacy migration / a fresh sign-in), or a harmless marker while the cookie session is believed to be active.
 * The server ignores a Bearer value that is not a valid token and falls back to the cookie.
 */
import { localizeError } from './apiErrors';

const LEGACY_KEY = 'coregsm_token';
const HINT_KEY = 'coregsm_signed';
const MARKER = 'cookie-session';
let memToken = '';

const hintOff = () => {
  try { return localStorage.getItem(HINT_KEY) === '0'; } catch { return false; }
};
const writeHint = (on: boolean) => {
  try { localStorage.setItem(HINT_KEY, on ? '1' : '0'); } catch { /* ignore */ }
};

export const getToken = (): string => memToken || (hintOff() ? '' : MARKER);

/** a real token from a sign-in response or the Discord redirect; '' = signed out */
export const setToken = (t: string) => {
  if (!t) {
    memToken = '';
    writeHint(false);
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
    return;
  }
  memToken = t;
  writeHint(true);
  // the login responses already set the cookie; the Discord redirect and old clients get it here (idempotent)
  void fetch('/api/auth/session', { method: 'POST', headers: { Authorization: `Bearer ${t}` } })
    .then((r) => { if (r.ok) memToken = ''; })
    .catch(() => undefined);
};

// every request to our API proves it comes from this page (the server's CSRF guard for cookie sessions)
if (typeof window !== 'undefined' && !(window as unknown as { __coregsmFetch?: boolean }).__coregsmFetch) {
  (window as unknown as { __coregsmFetch?: boolean }).__coregsmFetch = true;
  const native = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(url, window.location.href);
      if (u.origin === window.location.origin && u.pathname.startsWith('/api/')) {
        const headers = new Headers(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
        headers.set('X-CoreGSM', '1');
        return native(input, { ...init, headers, credentials: 'same-origin' });
      }
    } catch { /* fall through to the plain call */ }
    return native(input, init);
  };
}

// a token left by an older version: use it once to get the cookie, then forget it
try {
  const old = localStorage.getItem(LEGACY_KEY);
  if (old) {
    memToken = old;
    void fetch('/api/auth/session', { method: 'POST', headers: { Authorization: `Bearer ${old}` } })
      .then((r) => {
        if (r.ok) {
          memToken = '';
          writeHint(true);
          try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
        } else if (r.status === 401) {
          memToken = '';
          try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
        }
      })
      .catch(() => undefined);
  }
} catch { /* storage blocked */ }

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
  /** an active maintenance window for this server (null = none) */
  maintenance?: { name: string; until: number | null } | null;
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
      // only a real in-memory token (legacy migration); the cookie session needs no header
      ...(memToken ? { Authorization: `Bearer ${memToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') {
    setToken('');
    window.dispatchEvent(new Event('coregsm:logout'));
  }
  if (!res.ok) throw new ApiError(localizeError(data) ?? `Ошибка ${res.status}`, res.status, data as Record<string, unknown>);
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

/** SMTP settings (administrator); the password is never returned */
export interface SmtpInfo {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  passwordSet: boolean;
  /** letters can be sent */
  ready: boolean;
  /** trusted address used in letter links; null = unknown (reset letters are not sent) */
  publicBase: string | null;
}

export interface BotStatus {
  state: 'idle' | 'connecting' | 'online' | 'error';
  tag: string | null;
  clientId: string | null;
  inviteUrl: string | null;
  /** Discord servers the bot is on, and text channels it can post in */
  guildCount?: number;
  channelCount?: number;
  /** slash commands the bot registered in Discord (null: not reported yet) */
  commands?: number | null;
  commandList?: { name: string; description: string }[];
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
  /** minutes the server was down that day (unplanned / in a maintenance window) and how many outages began */
  down?: number;
  planned?: number;
  incidents?: number;
}

/** a stretch in which a server did not answer; end null = still down */
export interface StatusIncident {
  serverId: number;
  serverName: string;
  game: string;
  start: number;
  end: number | null;
  minutes: number;
  playersBefore: number;
  planned: boolean;
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
  /** hourly average ping of the last 24 hours, oldest first (null = no answer that hour) */
  latency?: (number | null)[];
}

export interface StatusInfo {
  updatedAt: number;
  servers: StatusServer[];
  /** newest first, 30 days */
  incidents?: StatusIncident[];
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
  events: { ts: number; type: 'up' | 'down' | 'peak' | 'maintenance'; players: number | null; name?: string }[];
  /** the usual players per hour of the week (index = UTC weekday * 24 + hour) over the 4 weeks before; null = unknown */
  baseline?: (number | null)[] | null;
  /** players with the time they joined (empty when the game gives no names) */
  playersNow: PlayerNow[];
}

export interface PlayerNow {
  name: string;
  /** ms: when the player joined */
  since: number;
  /** V Rising servers only: rank id of the ladder (see vrisingRanks.ts) */
  rankId?: string;
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
  /** site-only fields (optional; an older backend simply does not send them) */
  category?: NewsCategory;
  pinned?: boolean;
  /** game id (games.ts); drives the default cover */
  game?: string;
  gallery?: NewsGalleryItem[];
  changes?: NewsChange[];
  countdownAt?: number | null;
  countdownLabel?: string;
  actions?: NewsAction[];
}

export type NewsCategory = 'announcement' | 'wipe' | 'update' | 'event' | 'maintenance' | 'other';
export interface NewsGalleryItem { url?: string; upload?: string }
export type NewsChangeKind = 'add' | 'fix' | 'remove' | 'change';
export interface NewsChange { kind: NewsChangeKind; text: string }
export interface NewsAction { label: string; url: string }

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
  /** the address was confirmed by a link from a letter */
  emailVerified?: boolean;
  /** a sign-in from an unseen device within the last 24 h */
  newDevice?: { ts: number; label: string } | null;
  /** unread in-panel notifications (the bell badge) */
  unreadNotifications?: number;
  /** language and regional settings (absent on older servers) */
  prefs?: Prefs;
  /** "/api/..." url of the uploaded banner, null when there is none */
  bannerUrl?: string | null;
  /** gradient preset id ('' = none) */
  bannerPreset?: string;
}

// ---------- profile: preferences, player card, statistics, achievements ----------
export interface Prefs {
  lang: 'ru' | 'en';
  /** IANA name, '' = as in the system */
  timezone: string;
  timeFormat: '24' | '12';
  dateFormat: 'dmy' | 'mdy' | 'iso';
}

/** GET /me/nick-status */
export interface NickStatus {
  nick: string;
  seen: boolean;
  lastSeenAt: number | null;
  similar: string[];
}

/** GET/PUT /me/player */
export interface PlayerProfile {
  gameNick: string;
  bio: string;
  publicProfile: boolean;
}

/** GET /me/stats?days= */
export interface MyStats {
  days: number;
  nick: string;
  totalSeconds: number;
  sessions: number;
  longestSessionSec: number;
  streakDays: number;
  lastSeenAt: number | null;
  favouriteServerId: number | null;
  byServer: { serverId: number; name: string; game: string; seconds: number; sessions: number }[];
  /** date: YYYY-MM-DD, oldest first */
  byDay: { date: string; seconds: number }[];
  /** 24 numbers: seconds (or any unit) played in each hour of the day */
  hourly: number[];
}

/** GET /me/achievements */
export interface Achievement {
  id: string;
  title: string;
  description: string;
  /** clock flame moon sun star server shield calendar crown heart */
  icon: string;
  earned: boolean;
  progress: number;
  target: number;
  earnedAt: number | null;
}

/** GET /me/rank (V Rising) */
export interface MyRank {
  game: 'vrising';
  hours: number;
  rank: { id: string; name: string; minHours: number; color: string; image: string };
  next: { id: string; name: string; minHours: number; color: string; image: string } | null;
  /** 0..1 towards `next` */
  progress: number;
  sessions: number;
  nick: string;
}

/** GET /me/achievements/vrising */
export interface VrAchievement extends Achievement {
  game: 'vrising';
  image: string;
}

/** GET /me/activity */
export interface ActivityItem {
  ts: number;
  kind: 'session' | 'account';
  text: string;
}

export type JournalKind =
  | 'login' | 'login_failed' | 'password_changed' | 'email_changed' | 'discord_linked' | 'discord_unlinked'
  | 'avatar_changed' | 'banner_changed' | 'sessions_revoked' | 'prefs_changed' | 'profile_changed' | 'register_discord' | 'nick_seen';

/** GET /me/journal */
export interface JournalItem {
  id: number | string;
  ts: number;
  kind: JournalKind | string;
  ip: string;
  ua: string;
  detail: string;
}

/** GET /u/:username (no sign-in; 404 when the profile is private) */
export interface PublicProfile {
  username: string;
  role: 'admin' | 'moderator' | 'player';
  avatarUrl: string | null;
  bannerUrl: string | null;
  bannerPreset: string;
  gameNick: string;
  bio: string;
  /** ms (or an ISO string) */
  memberSince: number | string | null;
  stats: { totalSeconds: number; sessions: number; streakDays: number; favouriteServerName: string | null };
  achievements: { id: string; title: string; icon: string }[];
  rank?: { id: string; name: string; color: string; image: string };
  vrAchievements?: { id: string; title: string; image: string }[];
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
  /** all of the below may be missing on an older backend */
  category?: NewsCategory;
  pinned?: boolean;
  authorRole?: 'admin' | 'moderator' | 'player' | null;
  reactions?: NewsReaction[];
}

export type NewsEmoji = '👍' | '🔥' | '❤️' | '😮';
export interface NewsReaction { emoji: string; count: number; mine: boolean }

/** GET /news/:id */
export interface PublicNewsFull extends PublicNews {
  prev?: { id: number; title: string } | null;
  next?: { id: number; title: string } | null;
}

/** who signs a news item (the Discord display name 1:1 and picture when linked, else the site login and picture) */
export interface NewsAuthor { name: string; iconUrl: string | null; source: 'discord' | 'site' }
