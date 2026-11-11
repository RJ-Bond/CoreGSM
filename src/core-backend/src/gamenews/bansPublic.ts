/**
 * The «Баны» page: the bans that the game plugin has put in force, as a list for the panel.
 *   GET /api/bans?server=<id>&q=<nick>   whoever may open the panel (a closed panel: signed-in people only)
 * A guest and a player see the nickname, the reason, the server, the day and until when. The game account (platform id) and the name of the
 * administrator who gave the ban are shown to the staff only. A short block after a kick is not a ban and is not listed.
 */
import type { Express, Request } from 'express';
import { isStaff, viewer } from '../security/auth.js';
import { holdsOn, listBans, type BanRow } from './gameNewsModLog.js';
import { serverLabel } from './gameNewsVars.js';
import { db } from '../db.js';

export interface PublicBan {
  nick: string;
  reason: string;
  serverId: number;
  server: string;
  /** all | server: where the ban holds */
  scope: 'all' | 'server';
  createdAt: number;
  /** until when (0 = for ever) */
  until: number;
  /** staff only */
  admin?: string;
  platformId?: string;
}

export interface BansAnswer {
  total: number;
  forever: number;
  last7d: number;
  servers: { id: number; name: string; count: number }[];
  items: PublicBan[];
}

/** the list in the shape that is given out: the staff sees more */
export function shapeBans(rows: BanRow[], opts: { staff: boolean; server?: number; q?: string; label?: (id: number) => string }): PublicBan[] {
  const label = opts.label ?? serverLabel;
  const q = (opts.q ?? '').trim().toLowerCase();
  return rows
    .filter((r) => r.kind === 'ban')
    .filter((r) => opts.server === undefined || holdsOn(r, opts.server))
    .filter((r) => !q || r.nick.toLowerCase().includes(q) || r.reason.toLowerCase().includes(q))
    .map((r): PublicBan => ({
      nick: r.nick,
      reason: r.reason,
      serverId: r.server_id,
      server: r.server_id ? label(r.server_id) : '',
      scope: r.scope === 'server' ? 'server' : 'all',
      createdAt: r.created_at,
      until: r.until,
      ...(opts.staff ? { admin: r.admin, platformId: r.platform_id } : {}),
    }));
}

export function registerBans(app: Express): void {
  app.get('/api/bans', viewer, (req: Request, res) => {
    const now = Date.now();
    const all = listBans(now).filter((r) => r.kind === 'ban');
    const serverQ = Number(req.query.server);
    const server = Number.isInteger(serverQ) && serverQ > 0 ? serverQ : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 60) : '';
    const staff = isStaff(req);
    const items = shapeBans(all, { staff, server, q }).slice(0, 500);
    // the servers that have bans (the filter) and the figures over all of them, whatever the filter says
    const counts = new Map<number, number>();
    for (const r of all) if (r.server_id) counts.set(r.server_id, (counts.get(r.server_id) ?? 0) + 1);
    const week = (db.prepare("SELECT COUNT(*) AS n FROM game_mod_log WHERE kind = 'ban' AND ts >= ?").get(now - 7 * 86_400_000) as { n: number }).n;
    const out: BansAnswer = {
      total: all.length,
      forever: all.filter((r) => r.until === 0).length,
      last7d: week,
      servers: [...counts.entries()].map(([id, count]) => ({ id, name: serverLabel(id), count })).sort((a, b) => b.count - a.count),
      items,
    };
    res.set('Cache-Control', 'private, max-age=15');
    res.json(out);
  });
}
