/**
 * The public read-only API, version 1. Every call (except the description) needs an API key (apiKeys.ts):
 *
 *   GET /api/v1/status         totals: servers, how many are up, players
 *   GET /api/v1/servers        the servers (?game=, ?online=true|false)
 *   GET /api/v1/servers/:id    one server
 *   GET /api/v1/openapi.json   the OpenAPI 3 description (no key needed)
 *
 * Only public data: never the host and port used for polling. The display address is given only while the panel is
 * open to guests. Errors are always { error: { code, message } }.
 */
import type { Express, Request, Response } from 'express';
import { APP_VERSION } from './config.js';
import { db } from './db.js';
import { publicPanel } from './auth.js';
import { apiError, apiKeyAuth } from './apiKeys.js';
import { openApiSpec } from './openapi.js';
import { type ServerJoin, SELECT_SERVERS, SERVER_ORDER, serialize } from './serverData.js';
import { baseOf, brand, publicBase } from './site.js';
import { publicName } from './widgets.js';

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

  // everything else under /api/v1: one error format instead of the panel's 404
  app.use('/api/v1', (_req, res) => apiError(res, 404, 'not_found', 'No such endpoint. See /api/v1/openapi.json.'));
}
