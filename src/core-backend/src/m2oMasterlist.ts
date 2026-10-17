/**
 * The public masterlist of Mafia II: Online (https://masterlist.mafiahub.dev/servers, one list for all MafiaHub games).
 *
 * A server announces itself there when it has a `server-token`; the name of the entry belongs to the masterlist
 * account of that token, the server itself never says its name (neither its HTTP info nor the UDP query does).
 * So the name and the number of players of a listed server come from here, matched by IP and game port;
 * a server that is not announced simply has no name and the panel shows the one an administrator typed.
 * The list is fetched at most once a minute for every server together; a failure is silent (the old data is kept).
 */
import dns from 'node:dns/promises';
import net from 'node:net';

export const MASTERLIST_URL = 'https://masterlist.mafiahub.dev/servers';
const GAMEMODE = 'm2o';
const TTL_MS = 60_000;
/** an entry that was not pinged for this long is a server that is gone */
export const FRESH_MS = 150_000;

export interface MasterEntry {
  name: string | null;
  ip: string;
  port: number;
  players: number;
  maxPlayers: number;
  version: string | null;
  passworded: boolean;
  /** ms since epoch of the last ping of the server to the masterlist; 0 when unknown */
  lastPing: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Entries of the Mafia II: Online game mode out of the list's JSON; anything else in it is ignored. */
export function parseMasterlist(raw: unknown): MasterEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: MasterEntry[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (typeof o.gamemode !== 'string' || o.gamemode.toLowerCase() !== GAMEMODE) continue;
    const ip = str(o.ip);
    if (!ip) continue;
    const ts = typeof o.last_ping === 'string' ? Date.parse(o.last_ping) : NaN;
    out.push({
      name: str(o.name),
      ip,
      port: int(o.port) || 27015,
      players: int(o.current_players),
      maxPlayers: int(o.max_players),
      version: str(o.version),
      passworded: o.passworded === true,
      lastPing: Number.isFinite(ts) ? ts : 0,
    });
  }
  return out;
}

async function realSource(): Promise<unknown> {
  const res = await fetch(MASTERLIST_URL, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse((await res.text()).slice(0, 2_000_000));
}

let cache: { at: number; entries: MasterEntry[] } | null = null;
let loading: Promise<MasterEntry[]> | null = null;
let source: () => Promise<unknown> = realSource;

/** for the tests: replace the source of the list (null = the real one) and forget the cache */
export function setMasterlistSource(fn: (() => Promise<unknown>) | null): void {
  cache = null;
  loading = null;
  source = fn ?? realSource;
}

async function entries(now: number): Promise<MasterEntry[]> {
  if (cache && now - cache.at < TTL_MS) return cache.entries;
  loading ??= source()
    .then((raw) => {
      cache = { at: Date.now(), entries: parseMasterlist(raw) };
      return cache.entries;
    })
    // masterlist down: keep what we had and try again in a minute, a poll must not fail because of it
    .catch(() => {
      cache = { at: Date.now(), entries: cache?.entries ?? [] };
      return cache.entries;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

async function addressesOf(host: string): Promise<string[]> {
  if (net.isIP(host)) return [host];
  try {
    return (await dns.lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return [];
  }
}

/** The entry of the server with this host and game port, or null (not announced, or the list is unreachable). */
export async function findInMasterlist(host: string, port: number, now = Date.now()): Promise<MasterEntry | null> {
  const list = await entries(now);
  if (list.length === 0) return null;
  const addrs = await addressesOf(host);
  return list.find((e) => e.port === port && addrs.includes(e.ip)) ?? null;
}
