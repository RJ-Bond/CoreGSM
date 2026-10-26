/** Servers as the API returns them, and the Discord embed built from a server and its history. */
import { channelInfo } from './botState.js';
import { APP_VERSION, APP_VERSION_NAME } from './config.js';
import { coverUrl } from './covers.js';
import { type BindingRow, db, getSetting, type ServerRow, type StatusRow } from './db.js';
import { buildEmbed } from './embed.js';
import { chartSign } from './serverChart.js';
import { countryLabel, countryOf } from './geo.js';
import { maintenanceFor } from './maintenance.js';
import { brand, logoFile, publicBase } from './site.js';

/** What a non-admin may see: the display address, never the internal host/port used for querying. */
export function publicServer<T extends { host: string; port: number; queryPort: number | null; customName: string }>(s: T): T {
  return { ...s, host: '', port: 0, queryPort: null, customName: '' };
}

export type ServerJoin = ServerRow & Partial<Omit<StatusRow, 'server_id' | 'name'>> & { has_status: number | null; query_name: string | null };

export function serialize(r: ServerJoin) {
  return {
    id: r.id,
    // shown title: custom name > name reported by the server > host:port
    name: r.name || r.query_name || r.display_address || `${r.host}:${r.port}`,
    customName: r.name,
    nameAuto: !r.name,
    game: r.game,
    host: r.host,
    port: r.port,
    queryPort: r.query_port,
    displayAddress: r.display_address,
    country: r.country ?? '',
    coverUrl: coverUrl(r.id),
    // the address shown in the panel and on cards
    address: r.display_address || `${r.host}:${r.port}`,
    hasStatus: r.has_status != null,
    online: !!r.online,
    players: r.players ?? 0,
    maxPlayers: r.max_players ?? 0,
    map: r.map ?? null,
    version: r.version ?? null,
    ping: r.ping ?? null,
    playerNames: r.player_names ? (JSON.parse(r.player_names) as string[]) : [],
    error: r.error ?? null,
    updatedAt: r.updated_at ?? null,
    // since when the server is in its current state (online / offline); null = not known yet
    stateSince: r.state_since ?? null,
    // running maintenance window for this server (alerts are muted, downtime is not counted) or null
    maintenance: maintenanceFor(r.id),
  };
}

export const SELECT_SERVERS = `
SELECT s.*, st.online, st.players, st.max_players, st.map, st.version, st.ping, st.player_names, st.error,
       st.updated_at, st.state_since, st.server_id AS has_status, st.name AS query_name
FROM servers s LEFT JOIN status st ON st.server_id = s.id`;

/** the manual order first (pinned servers), the rest by id */
export const SERVER_ORDER = 's.sort_order IS NULL, s.sort_order, s.id';

export function getServer(id: number) {
  const row = db.prepare(`${SELECT_SERVERS} WHERE s.id = ?`).get(id) as ServerJoin | undefined;
  return row ? serialize(row) : null;
}

/** bump when the game icon artwork changes: Discord caches embed images by URL */
export const GAME_ICON_VERSION = 4;

/** the extra servers of a binding (ids that still exist, without the main one and without duplicates) */
export function extraIds(b: BindingRow): number[] {
  try {
    const raw = JSON.parse(b.extra_ids || '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<number>([b.server_id]);
    const out: number[] = [];
    for (const v of raw) {
      const n = Number(v);
      if (!Number.isInteger(n) || seen.has(n)) continue;
      if (!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  } catch {
    return [];
  }
}

export const cleanExtra = (main: number, ids: number[] | undefined): number[] =>
  [...new Set(ids ?? [])].filter((n) => n !== main && !!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(n)).slice(0, 9);

export const serializeBinding = (b: BindingRow) => ({
  channelName: channelInfo(b.channel_id).channelName,
  guildName: channelInfo(b.channel_id).guildName,
  id: b.id,
  serverId: b.server_id,
  // every server shown in the message: the main one first
  serverIds: [b.server_id, ...extraIds(b)],
  channelId: b.channel_id,
  messageId: b.message_id,
  intervalSec: b.interval_sec,
  enabled: !!b.enabled,
  lastUpdate: b.last_update,
  lastError: b.last_error,
  style: b.style,
});

// The Discord embed for a server. One builder serves the bot (what is posted) and the panel (the preview).
export const playersShown = () => {
  const n = Number(getSetting('embed_players_shown'));
  return Number.isFinite(n) && getSetting('embed_players_shown') !== '' ? Math.min(20, Math.max(0, Math.round(n))) : 5;
};

export function embedFor(serverId: number, intervalSec: number) {
  const server = getServer(serverId);
  if (!server) return null;
  // longest in the game first: the list shows who has been there the longest
  try {
    const since = new Map((db.prepare('SELECT name, since FROM player_now WHERE server_id = ?').all(serverId) as { name: string; since: number }[]).map((p) => [p.name.toLowerCase(), p.since]));
    if (since.size > 0 && Array.isArray(server.playerNames)) {
      server.playerNames = [...server.playerNames].sort((a, b) => (since.get(a.toLowerCase()) ?? Infinity) - (since.get(b.toLowerCase()) ?? Infinity));
    }
  } catch {
    /* the order is a nicety */
  }
  const up = db
    .prepare('SELECT AVG(online) * 100 AS u FROM history WHERE server_id = ? AND ts > ? AND unconfirmed = 0 AND maint = 0')
    .get(serverId, Date.now() - 24 * 3600 * 1000) as { u: number | null };
  const last = db.prepare('SELECT MAX(ts) AS t FROM history WHERE server_id = ? AND online = 1').get(serverId) as { t: number | null };
  const base = publicBase();
  return buildEmbed(server, up.u, intervalSec, { serverId, playersShown: playersShown(), lastOnlineAt: last.t, thumbUrl: base ? `${base}/api/game-icon/${server.game}.png?v=${GAME_ICON_VERSION}${getSetting('embed_icon_tile') === '1' ? '&tile=1' : ''}` : null, baseUrl: base, version: APP_VERSION_NAME || APP_VERSION || null, brandName: brand().name, country: (() => { const c = server.country || countryOf(serverId, server.host); return c ? countryLabel(c) : null; })(), timeZone: getSetting('timezone') || process.env.TZ || 'Europe/Moscow', logoUrl: base && logoFile() ? `${base}/api/branding/logo?v=${brand().logoV}` : null, chartUrl: base && getSetting('embed_chart') !== '0' ? `${base}/api/server-chart/${serverId}-${chartSign(serverId)}.png?v=${Math.floor(Date.now() / 600_000)}` : null });
}

export const intervalParam = (v: unknown) => Math.min(3600, Math.max(30, Number(v) || 60));
