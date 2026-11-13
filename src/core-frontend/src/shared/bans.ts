// GENERATED from src/shared/types/bans.ts by tools/sync-shared.mjs: do not edit here.
/**
 * The shapes of the answers of /api/bans, /api/bans/history and /api/bans/appeals: one definition for the backend (what it sends) and the
 * panel (what it reads). Edit it HERE, then run `node tools/sync-shared.mjs`: the file is copied into both packages (each Docker build
 * sees only its own folder), and CI fails when a copy differs from this one.
 */

/** one ban in force; `admin` and `platformId` are given to the staff only */
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
  admin?: string;
  platformId?: string;
}

/** GET /api/bans */
export interface BansData {
  total: number;
  forever: number;
  last7d: number;
  servers: { id: number; name: string; count: number }[];
  items: PublicBan[];
}

/** GET /api/bans/history: a ban or an unban of the log of the moderation */
export interface BanHistoryItem {
  kind: 'ban' | 'unban';
  nick: string;
  reason: string;
  serverId: number;
  server: string;
  at: number;
  /** a ban: until when (0 = for ever) */
  until: number;
  /** a ban that has run out by itself */
  expired: boolean;
  /** staff only */
  admin?: string;
}

/** GET /api/bans/appeals (staff) */
export interface Appeal {
  id: number;
  at: number;
  nick: string;
  platformId: string;
  text: string;
  contact: string;
  status: 'open' | 'accepted' | 'rejected';
  note: string;
  decidedBy: string | null;
  decidedAt: number | null;
}
