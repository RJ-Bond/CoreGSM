/**
 * Counters of failed sign-ins, kept in SQLite (table login_guard) so a restart of the backend does not reset a
 * lockout. Each row is a small JSON document with its own expiry; expired rows read as absent and are pruned hourly.
 */
import { db } from './db.js';

export type GuardScope = 'account' | 'ip' | 'attempts';

const getStmt = db.prepare('SELECT data FROM login_guard WHERE scope = ? AND key = ? AND expires_at > ?');
const setStmt = db.prepare(
  'INSERT INTO login_guard (scope, key, data, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT (scope, key) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at',
);
const delStmt = db.prepare('DELETE FROM login_guard WHERE scope = ? AND key = ?');

export function guardGet<T>(scope: GuardScope, key: string): T | null {
  const r = getStmt.get(scope, key, Date.now()) as { data: string } | undefined;
  if (!r) return null;
  try {
    return JSON.parse(r.data) as T;
  } catch {
    return null;
  }
}

export function guardSet<T>(scope: GuardScope, key: string, data: T, expiresAt: number): void {
  setStmt.run(scope, key, JSON.stringify(data), Math.round(expiresAt));
}

export function guardDelete(scope: GuardScope, key: string): void {
  delStmt.run(scope, key);
}

setInterval(() => db.prepare('DELETE FROM login_guard WHERE expires_at <= ?').run(Date.now()), 3600_000).unref();
