/**
 * Settings of the game plugin that can differ per server: the greeting, join/leave, registration, the chat in Discord, the
 * words of the restart. Each has a general value (`key`) and, for a server that has its own, an override (`key@<id>`).
 * A server without an override uses the general value, so changing it changes all of those servers.
 */
import type { Request } from 'express';
import { db, getSetting, setSetting } from '../db.js';

export const SCOPED_KEYS = ['gamenews_welcome', 'gamenews_joinleave', 'gamenews_register', 'gamenews_chat', 'gamenews_restart_texts', 'gamenews_kick'] as const;

const key = (base: string, serverId?: number): string => (serverId ? `${base}@${serverId}` : base);

/** the text of the setting for a server: its own when it has one, else the general one */
export const readScoped = (base: string, serverId?: number): string =>
  (serverId ? getSetting(key(base, serverId)) : null) || getSetting(base) || '';

export const hasOverride = (base: string, serverId: number): boolean => !!getSetting(key(base, serverId));

export const writeScoped = (base: string, value: string, serverId?: number): void => setSetting(key(base, serverId), value);

export const clearOverride = (base: string, serverId: number): void => setSetting(key(base, serverId), null);

/** `?server=<id>` of a request: the server whose own settings are meant (none = the general ones) */
export function serverOf(req: Request): number | undefined {
  const n = Number(req.query.server);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** the servers that have their own value of each setting: { gamenews_welcome: [3], ... } */
export function overrides(): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const k of SCOPED_KEYS) {
    const rows = db.prepare('SELECT key FROM settings WHERE key LIKE ?').all(`${k}@%`) as { key: string }[];
    out[k] = rows.map((r) => Number(r.key.slice(k.length + 1))).filter((n) => Number.isInteger(n) && n > 0);
  }
  return out;
}
