/**
 * The public read-only API, version 1. Every call (except the description) needs an API key (apiKeys.ts):
 *
 *   GET /api/v1/status         totals: servers, how many are up, players
 *   GET /api/v1/servers        the servers (?game=, ?online=true|false)
 *   GET /api/v1/servers/:id    one server
 *   GET /api/v1/servers/:id/history?hours=24     the curve of players and ping (up to 168 hours, at most 180 points)
 *   GET /api/v1/servers/:id/events?hours=168     went down / came back / the peak, newest first
 *   GET /api/v1/servers/:id/players              who is in the game now (names only while the panel is open to guests)
 *   GET /api/v1/community?days=7                 the most active players of the period (only while the panel is open to guests)
 *   GET /api/v1/openapi.json   the OpenAPI 3 description (no key needed)
 *
 * Only public data: never the host and port used for polling. The display address is given only while the panel is
 * open to guests. Errors are always { error: { code, message } }.
 */
import type { Express, Request, Response } from 'express';
import { APP_VERSION } from '../config.js';
import { db } from '../db.js';
import { publicPanel } from '../security/auth.js';
import { apiError, apiKeyAuth } from '../security/apiKeys.js';
import { openApiSpec } from './openapi.js';
import { type ServerJoin, SELECT_SERVERS, SERVER_ORDER, serialize } from '../monitoring/serverData.js';
import { baseOf, brand, publicBase } from './site.js';
import { publicName } from '../images/widgets.js';

type Serialized = ReturnType<typeof serialize>;

/** one server the way the API shows it */
export function apiServer(sv: Serialized, uptime24h: number | null, showAddress: boolean) {
  return {
    id: sv.id,
    name: publicName(sv),
    game: sv.game,
    online: sv.online,
    status: !sv.hasStatus ? 'unknown' : sv.online ? 'online' : 'offline',
    players: sv.online ? sv.players : 0,
    maxPlayers: sv.maxPlayers,
    ping: sv.online ? sv.ping : null,
    map: sv.online ? sv.map : null,
    version: sv.online ? sv.version : null,
    address: showAddress ? sv.displayAddress || sv.address : null,
    uptime24h,
    stateSince: sv.stateSince,
    updatedAt: sv.updatedAt,
    maintenance: !!sv.maintenance,
  };
}

function uptimes(since: number): Map<number, number> {
  const out = new Map<number, number>();
  const rows = db
    .prepare('SELECT server_id, AVG(CASE WHEN unconfirmed = 0 AND maint = 0 THEN online END) * 100 AS u FROM history WHERE ts > ? GROUP BY server_id')
    .all(since) as { server_id: number; u: number | null }[];
  for (const r of rows) if (r.u != null) out.set(r.server_id, Math.round(r.u * 10) / 10);
  return out;
}

const list = (): Serialized[] => (db.prepare(`${SELECT_SERVERS} ORDER BY ${SERVER_ORDER}`).all() as ServerJoin[]).map(serialize);

export function registerPublicApi(app: Express): void {
  // not matched by anything: a wrong path under /api/v1 gets the same error format
  app.get('/api/v1/openapi.json', (req: Request, res: Response) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(openApiSpec({ version: APP_VERSION, baseUrl: publicBase() ?? baseOf(req), title: brand().name }));
  });

  app.get('/api/v1/status', apiKeyAuth, (_req, res) => {
    const all = list();
    const online = all.filter((s) => s.online).length;
    res.set('Cache-Control', 'private, max-age=10');
    res.json({
      name: brand().name,
      servers: all.length,
      online,
      offline: all.length - online,
      players: all.reduce((n, s) => n + (s.online ? s.players : 0), 0),
      generatedAt: Date.now(),
    });
  });

  app.get('/api/v1/servers', apiKeyAuth, (req, res) => {
    const up = uptimes(Date.now() - 86_400_000);
    const show = publicPanel();
    let all = list();
    const game = typeof req.query.game === 'string' ? req.query.game : '';
    if (game) all = all.filter((s) => s.game === game);
    if (req.query.online === 'true') all = all.filter((s) => s.online);
    else if (req.query.online === 'false') all = all.filter((s) => !s.online);
    res.set('Cache-Control', 'private, max-age=10');
    res.json({ servers: all.map((s) => apiServer(s, up.get(s.id) ?? null, show)) });
  });

  app.get('/api/v1/servers/:id', apiKeyAuth, (req, res) => {
    const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : 0;
    const row = id ? (db.prepare(`${SELECT_SERVERS} WHERE s.id = ?`).get(id) as ServerJoin | undefined) : undefined;
    if (!row) return void apiError(res, 404, 'not_found', 'No such server.');
    const up = uptimes(Date.now() - 86_400_000);
    res.set('Cache-Control', 'private, max-age=10');
    res.json(apiServer(serialize(row), up.get(id) ?? null, publicPanel()));
  });

  const serverId = (v: unknown): number => (/^\d+$/.test(String(v)) ? Number(v) : 0);
  const exists = (id: number): boolean => !!id && !!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(id);
  const hoursOf = (v: unknown, def: number): number => Math.min(168, Math.max(1, Number(v ?? def) || def));

  app.get('/api/v1/servers/:id/history', apiKeyAuth, (req, res) => {
    const id = serverId(req.params.id);
    if (!exists(id)) return void apiError(res, 404, 'not_found', 'No such server.');
    const hours = hoursOf(req.query.hours, 24);
    const since = Date.now() - hours * 3600_000;
    const bucketMs = Math.max(30_000, Math.ceil((hours * 3600_000) / 180));
    const points = db
      .prepare(
        `SELECT MIN(ts) AS ts, MAX(players) AS players, MIN(online) AS online,
                CAST(ROUND(AVG(CASE WHEN online = 1 THEN ping END)) AS INTEGER) AS ping
         FROM history WHERE server_id = ? AND ts > ? GROUP BY ts / CAST(? AS INTEGER) ORDER BY ts`,
      )
      .all(id, since, bucketMs) as { ts: number; players: number; online: number; ping: number | null }[];
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ serverId: id, hours, points: points.map((p) => ({ ts: p.ts, players: p.players, ping: p.ping, online: !!p.online })) });
  });

  app.get('/api/v1/servers/:id/events', apiKeyAuth, (req, res) => {
    const id = serverId(req.params.id);
    if (!exists(id)) return void apiError(res, 404, 'not_found', 'No such server.');
    const hours = hoursOf(req.query.hours, 168);
    const since = Date.now() - hours * 3600_000;
    const changes = db
      .prepare(
        `SELECT ts, online FROM (
           SELECT ts, online, LAG(online) OVER (ORDER BY ts) AS prev FROM history WHERE server_id = ? AND ts > ?
         ) WHERE prev IS NOT NULL AND prev <> online ORDER BY ts DESC LIMIT 100`,
      )
      .all(id, since) as { ts: number; online: number }[];
    const events: { ts: number; type: 'up' | 'down' | 'peak'; players: number | null }[] = changes.map((e) => ({ ts: e.ts, type: e.online ? 'up' : 'down', players: null }));
    const peak = db.prepare('SELECT players, ts FROM history WHERE server_id = ? AND ts > ? ORDER BY players DESC, ts DESC LIMIT 1').get(id, since) as { players: number; ts: number } | undefined;
    if (peak && peak.players > 0) events.push({ ts: peak.ts, type: 'peak', players: peak.players });
    events.sort((a, b) => b.ts - a.ts);
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ serverId: id, hours, events });
  });

  app.get('/api/v1/servers/:id/players', apiKeyAuth, (req, res) => {
    const id = serverId(req.params.id);
    if (!exists(id)) return void apiError(res, 404, 'not_found', 'No such server.');
    const st = db.prepare('SELECT online, players FROM status WHERE server_id = ?').get(id) as { online: number; players: number } | undefined;
    const online = !!st?.online;
    const names = publicPanel() && online ? (db.prepare('SELECT name, since FROM player_now WHERE server_id = ? ORDER BY since, name LIMIT 200').all(id) as { name: string; since: number }[]) : [];
    res.set('Cache-Control', 'private, max-age=10');
    res.json({ serverId: id, online, count: online ? st?.players ?? 0 : 0, players: names.map((p) => ({ name: p.name, since: p.since })) });
  });

  app.get('/api/v1/community', apiKeyAuth, (req, res) => {
    const days = Math.min(30, Math.max(1, Number(req.query.days ?? 7) || 7));
    const now = Date.now();
    const since = now - days * 86400_000;
    // names of players are shown only where the panel itself shows them to a guest
    const top = publicPanel()
      ? (db
          .prepare(
            `SELECT MIN(name) AS name, SUM(MIN(COALESCE(left_at, ?), ?) - MAX(joined_at, ?)) AS ms
             FROM player_sessions WHERE COALESCE(left_at, ?) > ? GROUP BY ulower(name) HAVING ms > 0 ORDER BY ms DESC LIMIT 20`,
          )
          .all(now, now, since, now, since) as { name: string; ms: number }[])
      : [];
    const all = list();
    res.set('Cache-Control', 'private, max-age=60');
    res.json({
      days,
      playersNow: all.reduce((n, s) => n + (s.online ? s.players : 0), 0),
      serversOnline: all.filter((s) => s.online).length,
      top: top.map((t) => ({ name: t.name, hours: Math.round((t.ms / 3600_000) * 10) / 10 })),
    });
  });

  // everything else under /api/v1: one error format instead of the panel's 404
  app.use('/api/v1', (_req, res) => apiError(res, 404, 'not_found', 'No such endpoint. See /api/v1/openapi.json.'));
}
