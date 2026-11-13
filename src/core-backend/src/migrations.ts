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
  {
    version: 10,
    name: 'status.state_since',
    // when the server entered its current state (online / offline); NULL = not known yet
    up: (db) => addColumn(db, 'status', 'state_since', 'INTEGER'),
  },
  {
    version: 11,
    name: 'health_samples.load_pct',
    // the load of the processor (1-minute load average per core, in percent); NULL = not measured (older samples, Windows)
    up: (db) => addColumn(db, 'health_samples', 'load_pct', 'REAL'),
  },
  {
    version: 12,
    name: 'alert_channels',
    // outgoing webhooks and e-mail for alerts; the signing secret is stored encrypted (secrets.ts)
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS alert_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  secret TEXT NOT NULL DEFAULT '',
  recipients TEXT NOT NULL DEFAULT '[]',
  events TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  allow_private INTEGER NOT NULL DEFAULT 0,
  last_status TEXT,
  last_error TEXT,
  last_at INTEGER,
  created_at INTEGER NOT NULL
);`),
  },
  {
    version: 13,
    name: 'api_keys+favorite_push_prefs',
    // api_keys: only the SHA-256 of a key is kept (the key itself is shown once); favorite_push_prefs: what a player wants pushed for favourite servers
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  last_used_at INTEGER,
  revoked_at INTEGER,
  rate_limit INTEGER NOT NULL DEFAULT 60
);
CREATE TABLE IF NOT EXISTS favorite_push_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  on_online INTEGER NOT NULL DEFAULT 1,
  on_free_slot INTEGER NOT NULL DEFAULT 1,
  on_down INTEGER NOT NULL DEFAULT 0
);`),
  },
  {
    version: 14,
    name: 'user_player.privacy',
    // what a public profile shows: a JSON object of switches, empty = everything shown
    up: (db) => { if (hasTable(db, 'user_player')) addColumn(db, 'user_player', 'privacy', "TEXT NOT NULL DEFAULT ''"); },
  },
  {
    version: 15,
    name: 'api_keys.expiry+allowlist',
    // expires_at: the key stops working then (null = never); allow_ips: the addresses it may be used from (one per line, '' = any)
    up: (db) => {
      if (!hasTable(db, 'api_keys')) return;
      addColumn(db, 'api_keys', 'expires_at', 'INTEGER');
      addColumn(db, 'api_keys', 'allow_ips', "TEXT NOT NULL DEFAULT ''");
      addColumn(db, 'api_keys', 'last_used_ip', "TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    version: 16,
    name: 'game_news',
    // game_news_targets: where the CoreGSM game plugin of a server listens (url + token); game_news_log: what was sent
    up: (db) => db.exec(`
CREATE TABLE IF NOT EXISTS game_news_targets (
  server_id INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  url TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS game_news_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER,
  server_name TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  sent_by TEXT NOT NULL DEFAULT '',
  sent_at INTEGER NOT NULL
);`),
  },
  {
    version: 17,
    name: 'game_news.pull',
    // the plugin polls the panel (no open port on the game server): token_hash = SHA-256 of the token the panel issued,
    // last_seen/plugin_version = the last poll; the log doubles as the queue: status queued | delivered | expired | failed
    up: (db) => {
      addColumn(db, 'game_news_targets', 'token_hash', "TEXT NOT NULL DEFAULT ''");
      addColumn(db, 'game_news_targets', 'last_seen', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'game_news_targets', 'plugin_version', "TEXT NOT NULL DEFAULT ''");
      addColumn(db, 'game_news_log', 'status', "TEXT NOT NULL DEFAULT 'failed'");
      addColumn(db, 'game_news_log', 'delivered_at', 'INTEGER');
      db.exec("UPDATE game_news_log SET status = CASE WHEN ok = 1 THEN 'delivered' ELSE 'failed' END");
      db.exec('CREATE INDEX IF NOT EXISTS game_news_log_queue ON game_news_log (server_id, status)');
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS game_news_targets_hash ON game_news_targets (token_hash) WHERE token_hash <> \'\'');
    },
  },
  {
    version: 18,
    name: 'game_news_rules',
    // automatic announcements: kind interval | daily | once; server_ids is a JSON array ('[]' = every server with a plugin);
    // times a JSON array of "HH:MM"; active_from/active_to limit the dates; next_run is when the scheduler sends it next
    up: (db) => db.exec(`
CREATE TABLE IF NOT EXISTS game_news_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  server_ids TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL DEFAULT 'interval',
  every_min INTEGER NOT NULL DEFAULT 60,
  times TEXT NOT NULL DEFAULT '[]',
  run_at INTEGER,
  active_from INTEGER,
  active_to INTEGER,
  only_online INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run INTEGER,
  next_run INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);`),
  },
  {
    version: 19,
    name: 'game_news_templates',
    // the administrator's own message templates
    up: (db) => db.exec(`
CREATE TABLE IF NOT EXISTS game_news_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);`),
  },
  {
    version: 20,
    name: 'game_news.heartbeat',
    // what the plugin reports with every poll: the name of the server in the game, who is playing and the limit
    // (the panel cannot always query the server itself, e.g. a server in a home network): plugin_players -1 = unknown
    up: (db) => {
      addColumn(db, 'game_news_targets', 'plugin_name', "TEXT NOT NULL DEFAULT ''");
      addColumn(db, 'game_news_targets', 'plugin_players', 'INTEGER NOT NULL DEFAULT -1');
      addColumn(db, 'game_news_targets', 'plugin_max', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 21,
    name: 'game_identities',
    // a player's game account (the platform id the game server verified) and the panel account made from the game
    up: (db) => db.exec(`
CREATE TABLE IF NOT EXISTS game_identities (
  platform_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nick TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_hint_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_game_identities_user ON game_identities(user_id);`),
  },
  {
    version: 22,
    name: 'game_restart_jobs',
    // a timer that restarts a game server: one row per server
    up: (db) => db.exec(`
CREATE TABLE IF NOT EXISTS game_restart_jobs (
  server_id INTEGER PRIMARY KEY,
  run_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  total_sec INTEGER NOT NULL,
  last_notice INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'counting'
);`),
  },
  {
    version: 23,
    name: 'game_restart_log',
    // the history of restarts by a timer: who asked, when, and how it ended (counting | done | cancelled | missed | replaced)
    up: (db) => db.exec(`
CREATE TABLE IF NOT EXISTS game_restart_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  run_at INTEGER NOT NULL,
  total_sec INTEGER NOT NULL,
  requested_by TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'counting',
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_game_restart_log_server ON game_restart_log(server_id, id);`),
  },
  {
    version: 24,
    name: 'game_restart_schedule',
    // planned restarts through the game plugin: a time of day, the days of the week (empty = every day), the warning before
    up: (db) => db.exec(`
CREATE TABLE IF NOT EXISTS game_restart_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL DEFAULT 0,
  time TEXT NOT NULL,
  days TEXT NOT NULL DEFAULT '[]',
  warn_sec INTEGER NOT NULL DEFAULT 600,
  enabled INTEGER NOT NULL DEFAULT 1,
  skip_r INTEGER NOT NULL DEFAULT 0,
  fired_r INTEGER NOT NULL DEFAULT 0
);`),
  },
  {
    version: 25,
    name: 'game_identities.visits',
    // when a linked player joined and left the server last: «Вы были на сервере 10.12.2026 в 10:00» at the next join
    up: (db) => {
      addColumn(db, 'game_identities', 'last_join_at', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'game_identities', 'last_leave_at', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 26,
    name: 'game_moderation',
    // what administrators did from the game (kick, ban, warning, unban), the bans in force, the commands the panel gives to the plugin
    up: (db) => db.exec(`
CREATE TABLE IF NOT EXISTS game_mod_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  platform_id TEXT NOT NULL DEFAULT '',
  nick TEXT NOT NULL DEFAULT '',
  admin TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  server_id INTEGER NOT NULL DEFAULT 0,
  until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_game_mod_log_player ON game_mod_log(platform_id, kind, ts);
CREATE TABLE IF NOT EXISTS game_bans (
  platform_id TEXT PRIMARY KEY,
  nick TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  admin TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  until INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'ban',
  server_id INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS game_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  result TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_game_commands_server ON game_commands(server_id, state);`),
  },
  {
    version: 27,
    name: 'game_bans_scope',
    // a ban holds on all servers (all) or only on the one where it was given (server)
    up: (db) => db.exec("ALTER TABLE game_bans ADD COLUMN scope TEXT NOT NULL DEFAULT 'all'"),
  },
  {
    version: 28,
    name: 'settings_history',
    // who changed which setting, from what to what (settings a person sets only; secrets and counters are not written)
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS settings_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT
);
CREATE INDEX IF NOT EXISTS idx_settings_history_ts ON settings_history(ts DESC);`),
  },
  {
    version: 29,
    name: 'rum_samples',
    // the speed the visitors really see: one value of one metric of one page, nothing about the person
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS rum_samples (
  ts INTEGER NOT NULL,
  route TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rum_samples ON rum_samples(route, metric, ts);`),
  },
  {
    version: 30,
    name: 'ban_appeals',
    // an appeal of a banned player (the staff reads and decides) and who of the staff wants a push about new bans and appeals
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS ban_appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  nick TEXT NOT NULL,
  platform_id TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT NOT NULL DEFAULT '',
  decided_by TEXT,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ban_appeals ON ban_appeals(status, ts);
CREATE TABLE IF NOT EXISTS ban_alerts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);`),
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
