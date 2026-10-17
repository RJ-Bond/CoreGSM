/**
 * Mafia II: Online (GameDig id `m2o`).
 *
 * The current server (MafiaHub framework, https://docs.mafia2online.com/guides/basics/server-setup/) listens on
 *   port      UDP   game traffic (27015 by default)
 *   port + 1  TCP   a small HTTP endpoint with the server metadata as JSON (used by the server browser and masterlist)
 * The documentation names `max_players` and the `mod` config but gives neither the path nor the other keys, so the
 * answer is read tolerantly: the usual spellings of every value are accepted and a missing value is simply left out.
 * An answer of any JSON object already proves that the server is up, which is what monitoring needs most.
 * The old UDP query (GameDig `m2o`, header «M2Online») stays as the fallback in query.ts.
 */

export interface M2oInfo {
  name: string | null;
  players: number;
  maxPlayers: number;
  map: string | null;
  version: string | null;
  playerNames: string[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};
const first = <T>(...vals: (T | null | undefined)[]): T | null => vals.find((v) => v != null) ?? null;

/** Reads the JSON of the info endpoint; null when it is not an object. */
export function parseM2oInfo(raw: unknown): M2oInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const mod = o.mod && typeof o.mod === 'object' && !Array.isArray(o.mod) ? (o.mod as Record<string, unknown>) : {};

  let players = 0;
  let playerNames: string[] = [];
  if (Array.isArray(o.players)) {
    playerNames = o.players
      .map((p) => (typeof p === 'string' ? p : p && typeof p === 'object' ? str((p as { name?: unknown }).name) : null))
      .filter((n): n is string => !!n && n.trim().length > 0)
      .map((n) => n.trim().slice(0, 64));
    players = o.players.length;
  } else {
    players = first(num(o.players), num(o.numplayers), num(o.player_count), num(o.playerCount), num(o.players_online), num(o.online), num(o.current_players)) ?? 0;
  }
  return {
    name: first(str(o.name), str(o.hostname), str(o.server_name), str(o.serverName), str(o.title)),
    players,
    maxPlayers: first(num(o.max_players), num(o.maxplayers), num(o.maxPlayers), num(o.slots)) ?? 0,
    map: first(str(o.map), str(mod.map)),
    version: first(str(o.version), str(mod.version), str(o.mod_version)),
    playerNames: playerNames.slice(0, 200),
  };
}

/** GET the info endpoint (`/`, then `/info`); resolves with the parsed answer and the round trip in ms. */
export async function fetchM2oInfo(host: string, port: number, timeoutMs = 3000): Promise<{ info: M2oInfo; ping: number }> {
  let lastError: unknown = new Error('no answer');
  for (const path of ['/', '/info']) {
    const started = Date.now();
    try {
      const res = await fetch(`http://${host.includes(':') ? `[${host}]` : host}:${port}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
        redirect: 'manual',
      });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      const text = (await res.text()).slice(0, 200_000);
      const info = parseM2oInfo(JSON.parse(text));
      if (info) return { info, ping: Date.now() - started };
      lastError = new Error('not a JSON object');
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
