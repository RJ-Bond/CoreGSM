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
  messageId: string | null;
  intervalSec: number;
  enabled: boolean;
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
