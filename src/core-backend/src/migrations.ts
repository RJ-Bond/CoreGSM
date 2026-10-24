/**
 * Versioned schema migrations.
 *
 * v1 is the baseline: the schema that db.ts creates with idempotent CREATE ... IF NOT EXISTS / ADD COLUMN code
 * (every database, new or old, has it after db.ts ran), so it is only recorded. Everything newer is a numbered
 * migration below. Rules: append only, never edit a released migration, keep each one idempotent.
 *
 * Before pending migrations are applied to an existing database a consistent copy of it is written to
 * <dir>/backups/pre-migrate-v<target>-<timestamp>.db (the newest 5 are kept). Each migration runs in its own
 * transaction; a failure stops the start-up with a clear message (the copy is the way back).
 */
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { addColumn, hasTable } from './schema.js';
import { log as logger } from './logger.js';

type Db = InstanceType<typeof Database>;

export interface Migration {
  version: number;
  name: string;
  up: (db: Db) => void;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'baseline', up: () => undefined },
  {
    version: 2,
    name: 'status.consecutive_failures',
    up: (db) => addColumn(db, 'status', 'consecutive_failures', 'INTEGER NOT NULL DEFAULT 0'),
  },
  {
    version: 3,
    name: 'history.unconfirmed+maint',
    up: (db) => {
      // unconfirmed = a failed poll that did not (yet) make the server offline; maint = taken during a maintenance window
      addColumn(db, 'history', 'unconfirmed', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'history', 'maint', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 4,
    name: 'maintenance_windows',
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  repeat TEXT NOT NULL DEFAULT 'none',
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maint_server ON maintenance_windows(server_id);`),
  },
  {
    version: 5,
    name: 'health_samples',
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS health_samples (
  ts INTEGER PRIMARY KEY,
  db_bytes INTEGER NOT NULL DEFAULT 0,
  rss_mb INTEGER NOT NULL DEFAULT 0,
  poll_ms INTEGER NOT NULL DEFAULT 0,
  poll_failures INTEGER NOT NULL DEFAULT 0,
  bot_state TEXT NOT NULL DEFAULT '',
  queue_len INTEGER NOT NULL DEFAULT 0,
  disk_free INTEGER
);`),
  },
  {
    version: 6,
    name: 'login_guard',
    // counters of failed sign-ins (per account and address, per address, attempts per address): they survive a restart
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS login_guard (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE INDEX IF NOT EXISTS idx_login_guard_expires ON login_guard(expires_at);`),
  },
  {
    version: 7,
    name: 'smart_state',
    // smart alerts: since when a condition holds (low online, high ping, almost full) and when it was last reported
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS smart_state (
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  since INTEGER,
  last_alert INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, kind)
);`),
  },
  {
    version: 8,
    name: 'users.perms',
    // what a moderator may do (JSON array of permission names); NULL = the default set
    up: (db) => addColumn(db, 'users', 'perms', 'TEXT'),
  },
  {
    version: 9,
    name: 'users.two_factor',
    // totp_secret is encrypted (secrets.ts); totp_recovery is a JSON array of sha256 hashes; totp_step guards against replaying a code
    up: (db) => {
      addColumn(db, 'users', 'totp_secret', 'TEXT');
      addColumn(db, 'users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'users', 'totp_recovery', 'TEXT');
      addColumn(db, 'users', 'totp_step', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export interface MigrationResult {
  applied: number[];
  /** path of the copy made before migrating (null: nothing to protect or nothing pending) */
  backup: string | null;
}

/** keeps the newest `keep` pre-migration copies */
export function prunePreMigrate(dir: string, keep = 5): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^pre-migrate-v\d+-\d+\.db$/.test(f))
      .map((f) => ({ f, t: Number(/-(\d+)\.db$/.exec(f)![1]) }))
      .sort((a, b) => b.t - a.t || (a.f < b.f ? 1 : -1));
    for (const x of files.slice(keep)) fs.rmSync(path.join(dir, x.f), { force: true });
  } catch {
    /* the directory may not exist */
  }
}

/**
 * Applies pending migrations. `existing` = the database had data before this start (a copy is made first).
 * `list` is injectable for tests.
 */
export function runMigrations(db: Db, opts: { dataDir: string; existing: boolean; list?: Migration[]; log?: (m: string) => void }): MigrationResult {
  const list = opts.list ?? MIGRATIONS;
  const log = opts.log ?? ((m: string) => logger.info(m));
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const done = new Set((db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version));
  const pending = list.filter((m) => !done.has(m.version)).sort((a, b) => a.version - b.version);
  const result: MigrationResult = { applied: [], backup: null };
  if (!pending.length) return result;

  // the baseline alone only records what already exists: no copy needed for that
  const real = pending.filter((m) => m.version > 1);
  if (opts.existing && real.length && hasTable(db, 'users')) {
    const target = real[real.length - 1].version;
    const dir = path.join(opts.dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `pre-migrate-v${target}-${Date.now()}.db`);
    try {
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    } catch (e) {
      throw new Error(`Не удалось сделать копию базы перед миграцией (${dest}): ${(e as Error).message}. Обновление схемы отменено.`);
    }
    result.backup = dest;
    log(`Database copy before migration: ${dest}`);
    prunePreMigrate(dir, 5);
  }

  for (const m of pending) {
    try {
      db.transaction(() => {
        m.up(db);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, Date.now());
      })();
    } catch (e) {
      throw new Error(`Миграция базы данных v${m.version} «${m.name}» не выполнена: ${(e as Error).message}${result.backup ? `. Копия базы до миграции: ${result.backup}` : ''}`);
    }
    result.applied.push(m.version);
    if (m.version > 1) log(`Database migration v${m.version} applied: ${m.name}`);
  }
  return result;
}

/** versions recorded in the database (for diagnostics and tests) */
export function appliedVersions(db: Db): number[] {
  if (!hasTable(db, 'schema_migrations')) return [];
  return (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map((r) => r.version);
}
