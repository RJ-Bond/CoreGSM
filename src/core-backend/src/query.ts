/** One query of a game server over its game protocol (GameDig). No database: the poller and the probes share it. */
import { GameDig } from 'gamedig';
import type { ServerRow } from './db.js';

export interface QueryResult {
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

/** Turns GameDig/network errors into a message a person can act on. */
export function humanizeQueryError(raw: string): string {
  const m = raw.toLowerCase();
  if (/invalid game|unknown game|game type/.test(m)) return 'Неизвестный тип игры. Выберите игру из списка или проверьте GameDig ID.';
  if (/enotfound|eai_again|getaddrinfo/.test(m)) return 'Адрес не найден. Проверьте имя или IP сервера.';
  if (/econnrefused/.test(m)) return 'Соединение отклонено: порт закрыт или сервер выключен.';
  if (/ehostunreach|enetunreach|network is unreachable/.test(m)) return 'Нет маршрута до сервера. Проверьте сеть и адрес.';
  if (/timed out|timeout|failed all|no response|etimedout/.test(m)) {
    return 'Сервер не ответил. Проверьте адрес и порт, включён ли сервер и разрешён ли query (некоторым играм нужен отдельный query-порт).';
  }
  return raw.slice(0, 160);
}

const clean = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  // strip Minecraft colour codes and control characters
  const v = s.replace(/§./g, '').replace(/[\u0000-\u001f]/g, ' ').trim();
  return v.length ? v.slice(0, 120) : null;
};

export async function queryServer(s: Pick<ServerRow, 'game' | 'host' | 'port' | 'query_port'> & Partial<ServerRow>): Promise<QueryResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await GameDig.query({
      type: s.game,
      host: s.host,
      port: s.query_port ?? s.port,
      maxRetries: 1,
      socketTimeout: 3000,
      attemptTimeout: 9000,
    });
    const names: string[] = Array.isArray(r.players)
      ? r.players.map((p: { name?: string }) => clean(p?.name)).filter((n: string | null): n is string => !!n)
      : [];
    const count = Number(r.numplayers ?? (Array.isArray(r.players) ? r.players.length : 0)) || 0;
    const rawVersion = r.version ?? r.raw?.version?.name ?? r.raw?.version ?? null;
    return {
      online: true,
      name: clean(r.name),
      players: count,
      maxPlayers: Number(r.maxplayers) || 0,
      map: clean(r.map),
      version: clean(typeof rawVersion === 'string' ? rawVersion : null),
      ping: typeof r.ping === 'number' ? Math.round(r.ping) : null,
      playerNames: names.slice(0, 200),
      error: null,
    };
  } catch (e) {
    return {
      online: false,
      name: null,
      players: 0,
      maxPlayers: 0,
      map: null,
      version: null,
      ping: null,
      playerNames: [],
      error: humanizeQueryError(e instanceof Error ? e.message : String(e)),
    };
  }
}

