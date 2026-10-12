/**
 * Country of a game server (for the flag in the Discord message), looked up once and cached.
 * The host is resolved to an IP and asked from a free GeoIP service; private addresses are skipped.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { db } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS server_geo (
  server_id INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  checked_at INTEGER NOT NULL
);
`);

const inflight = new Set<number>();

const isPrivate = (ip: string) =>
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === '::1' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip);

async function refresh(serverId: number, host: string): Promise<void> {
  let country = '';
  let ok = false;
  try {
    const name = host.replace(/^\[|\]$/g, '').split(':').length > 2 ? host : host.split(':')[0];
    const ip = net.isIP(name) ? name : (await dns.lookup(name)).address;
    if (!isPrivate(ip)) {
      const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code`, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'CoreGSM' } });
      const j = (await r.json()) as { success?: boolean; country_code?: string };
      if (j.success && j.country_code) {
        country = j.country_code.toUpperCase();
        ok = true;
      }
    } else {
      ok = true; // a local address has no country: do not ask again for a month
    }
  } catch {
    /* no DNS or no route to the service: try again later */
  }
  db.prepare(
    'INSERT INTO server_geo (server_id, host, country, checked_at) VALUES (?, ?, ?, ?) ON CONFLICT(server_id) DO UPDATE SET host = excluded.host, country = excluded.country, checked_at = excluded.checked_at',
  ).run(serverId, host, country, ok ? Date.now() : Date.now() - 29 * 24 * 3600 * 1000 + 3600_000);
}

/** The cached ISO country code ("PL"), or null; a refresh runs in the background when it is missing or old. */
export function countryOf(serverId: number, host: string): string | null {
  const row = db.prepare('SELECT host, country, checked_at FROM server_geo WHERE server_id = ?').get(serverId) as { host: string; country: string; checked_at: number } | undefined;
  const stale = !row || row.host !== host || Date.now() - row.checked_at > 30 * 24 * 3600 * 1000;
  if (stale && !inflight.has(serverId)) {
    inflight.add(serverId);
    void refresh(serverId, host).finally(() => inflight.delete(serverId));
  }
  return row && row.host === host && row.country ? row.country : null;
}

/** "🇵🇱 Польша" */
export function countryLabel(code: string): string {
  const flag = [...code.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
  let name = code;
  try {
    name = new Intl.DisplayNames(['ru'], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    /* keep the code */
  }
  return `${flag} ${name}`;
}
