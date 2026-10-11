import { GameDig } from 'gamedig';
import { db, type ServerRow } from './db.js';

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

const clean = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  // strip Minecraft colour codes and control characters
  const v = s.replace(/§./g, '').replace(/[\u0000-\u001f]/g, ' ').trim();
  return v.length ? v.slice(0, 120) : null;
};

export async function queryServer(s: ServerRow): Promise<QueryResult> {
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
      playerNames: names.slice(0, 50),
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
      error: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    };
  }
}

const upsert = db.prepare(`
INSERT INTO status (server_id, online, name, players, max_players, map, version, ping, player_names, error, updated_at)
VALUES (@id, @online, @name, @players, @max, @map, @version, @ping, @names, @error, @ts)
ON CONFLICT(server_id) DO UPDATE SET
  online=excluded.online, name=excluded.name, players=excluded.players, max_players=excluded.max_players,
  map=excluded.map, version=excluded.version, ping=excluded.ping, player_names=excluded.player_names,
  error=excluded.error, updated_at=excluded.updated_at
`);
const addHistory = db.prepare('INSERT INTO history (server_id, ts, online, players) VALUES (?, ?, ?, ?)');

export async function refreshServer(s: ServerRow): Promise<void> {
  const r = await queryServer(s);
  const ts = Date.now();
  // the server may have been deleted while the query was running
  const still = db.prepare('SELECT 1 FROM servers WHERE id = ?').get(s.id);
  if (!still) return;
  upsert.run({
    id: s.id,
    online: r.online ? 1 : 0,
    name: r.name,
    players: r.players,
    max: r.maxPlayers,
    map: r.map,
    version: r.version,
    ping: r.ping,
    names: JSON.stringify(r.playerNames),
    error: r.error,
    ts,
  });
  addHistory.run(s.id, ts, r.online ? 1 : 0, r.players);
}

let running = false;

export async function pollAll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const servers = db.prepare('SELECT * FROM servers').all() as ServerRow[];
    await Promise.allSettled(servers.map(refreshServer));
    db.prepare('DELETE FROM history WHERE ts < ?').run(Date.now() - 7 * 24 * 3600 * 1000);
  } finally {
    running = false;
  }
}

export function startPoller(intervalMs: number): void {
  void pollAll();
  setInterval(() => void pollAll(), intervalMs).unref?.();
}
