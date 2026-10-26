import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { canDecrypt, decryptSecret, encryptSecret, isEncrypted, isSecretKey, reencrypt, usesLegacyKey } from './secrets.js';
import { runMigrations } from './migrations.js';
import { addColumn } from './schema.js';
import { log } from './logger.js';

const dbPath = process.env.DB_PATH ?? './data/coregsm.db';
export const DATA_DIR = path.dirname(dbPath);
fs.mkdirSync(DATA_DIR, { recursive: true });

// A backup restored from the panel is staged in <DATA_DIR>/restore-pending/ (coregsm.db, news/*, brand-logo.*,
// manifest.json) and put in place here, before the database is opened.
const pendingDir = path.join(DATA_DIR, 'restore-pending');
let restoredNow = false;
if (fs.existsSync(pendingDir)) {
  try {
    const pendingDb = path.join(pendingDir, 'coregsm.db');
    if (!fs.existsSync(pendingDb)) throw new Error('в подготовленной копии нет базы данных');
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, `${dbPath}.before-restore`);
    for (const ext of ['-wal', '-shm']) {
      fs.rmSync(`${dbPath}${ext}`, { force: true });
      fs.rmSync(`${pendingDb}${ext}`, { force: true });
    }
    fs.copyFileSync(pendingDb, dbPath);
    // files of a full archive: news pictures are added, the logo is replaced by the one in the archive (if any)
    const full = fs.existsSync(path.join(pendingDir, 'manifest.json'));
    const newsSrc = path.join(pendingDir, 'news');
    if (fs.existsSync(newsSrc)) {
      fs.mkdirSync(path.join(DATA_DIR, 'news'), { recursive: true });
      for (const f of fs.readdirSync(newsSrc)) fs.copyFileSync(path.join(newsSrc, f), path.join(DATA_DIR, 'news', f));
    }
    if (full) {
      // covers and avatars: the archive's set replaces the current one (ids belong to the restored database)
      for (const [dir, re] of [
        ['covers', /^\d{1,9}(@s)?\.jpg$/],
        ['avatars', /^\d{1,9}\.png$/],
        ['banners', /^\d{1,9}\.jpg$/],
        ['gallery', /^\d{1,9}(@s)?\.jpg$/],
      ] as const) {
        const src = path.join(pendingDir, dir);
        if (!fs.existsSync(src)) continue;
        fs.mkdirSync(path.join(DATA_DIR, dir), { recursive: true });
        for (const f of fs.readdirSync(path.join(DATA_DIR, dir))) if (re.test(f)) fs.rmSync(path.join(DATA_DIR, dir, f), { force: true });
        for (const f of fs.readdirSync(src)) if (re.test(f)) fs.copyFileSync(path.join(src, f), path.join(DATA_DIR, dir, f));
      }
      for (const f of fs.readdirSync(DATA_DIR)) if (/^brand-logo\.(png|jpg|webp)$/.test(f)) fs.rmSync(path.join(DATA_DIR, f), { force: true });
      for (const f of fs.readdirSync(pendingDir)) if (/^brand-logo\.(png|jpg|webp)$/.test(f)) fs.copyFileSync(path.join(pendingDir, f), path.join(DATA_DIR, f));
    }
    restoredNow = true;
    log.info('Database restored from the uploaded backup (the previous one is kept as .before-restore)');
  } catch (e) {
    log.error('Restore failed:', (e as Error).message);
  }
  // never retry a half-done restore on every start
  fs.rmSync(pendingDir, { recursive: true, force: true });
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// SQLite lower()/NOCASE only fold ASCII: logins in any alphabet are compared with this
db.function('ulower', { deterministic: true }, (s) => String(s).toLowerCase());
// true when the database file already had data before this start (migrations then make a copy first)
const hadSchema = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, server_id)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  game TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  query_port INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS status (
  server_id INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  online INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  players INTEGER NOT NULL DEFAULT 0,
  max_players INTEGER NOT NULL DEFAULT 0,
  map TEXT,
  version TEXT,
  ping INTEGER,
  player_names TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  online INTEGER NOT NULL,
  players INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_server_ts ON history(server_id, ts);
CREATE TABLE IF NOT EXISTS bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  interval_sec INTEGER NOT NULL DEFAULT 60,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_update INTEGER,
  last_error TEXT
);
`);

// older databases: users get a role (every existing account was created by the setup wizard, so it is an admin)
addColumn(db, 'users', 'role', "TEXT NOT NULL DEFAULT 'admin'");
addColumn(db, 'users', 'created_at', 'INTEGER');

// accounts: approval status, linked Discord account, sessions
for (const [column, ddl] of [
  ['status', "TEXT NOT NULL DEFAULT 'active'"],
  ['discord_id', 'TEXT'],
  ['discord_name', 'TEXT'],
  ['discord_avatar', 'TEXT'],
  ['no_password', 'INTEGER NOT NULL DEFAULT 0'],
  ['email', 'TEXT'],
  // a block with a reason; banned_until NULL = for good, an ended ban is simply ignored
  ['banned_at', 'INTEGER'],
  ['banned_until', 'INTEGER'],
  ['ban_reason', 'TEXT'],
]) {
  addColumn(db, 'users', column, ddl);
}
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord ON users(discord_id) WHERE discord_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_history_ts ON history(ts);
-- who is online right now and since when (updated on every successful poll)
CREATE TABLE IF NOT EXISTS player_now (
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  since INTEGER NOT NULL,
  PRIMARY KEY (server_id, name)
);
-- per UTC day: polls, polls that found the server up, peak players (status page)
CREATE TABLE IF NOT EXISTS uptime_daily (
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  up INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  peak INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, day)
);
`);
addColumn(db, 'history', 'ping', 'INTEGER');
// manual order of the servers in lists (NULL = by id, after the ordered ones)
addColumn(db, 'servers', 'sort_order', 'INTEGER');
// profile: preferences, player profile, game sessions, account journal
db.exec(`
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lang TEXT NOT NULL DEFAULT 'ru',
  timezone TEXT NOT NULL DEFAULT '',
  time_format TEXT NOT NULL DEFAULT '24',
  date_format TEXT NOT NULL DEFAULT 'dmy',
  banner_preset TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS user_player (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  game_nick TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  public_profile INTEGER NOT NULL DEFAULT 0
);
-- one row per visit of a player (name as the game server reports it); left_at NULL while still online
CREATE TABLE IF NOT EXISTS player_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  left_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_psess_server_open ON player_sessions(server_id, left_at);
CREATE INDEX IF NOT EXISTS idx_psess_joined ON player_sessions(joined_at);
CREATE TABLE IF NOT EXISTS account_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_account_events_user ON account_events(user_id, ts);
`);
// the panel was down: sessions left open by the previous run end when the server was last polled
db.exec(`UPDATE player_sessions SET left_at = MAX(joined_at, COALESCE((SELECT updated_at FROM status WHERE status.server_id = player_sessions.server_id), joined_at)) WHERE left_at IS NULL`);

// a restored database starts with nobody signed in
if (restoredNow) {
  db.prepare('DELETE FROM sessions').run();
  // the restored database has no record of the restore itself
  db.prepare('INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)').run(Date.now(), 'система', 'Панель восстановлена из резервной копии', '');
}

// older databases: new columns are added once
addColumn(db, 'bindings', 'style', "TEXT NOT NULL DEFAULT 'embed'");

// one Discord message may show several servers (up to 10 embeds): the extra server ids
addColumn(db, 'bindings', 'extra_ids', "TEXT NOT NULL DEFAULT '[]'");

// older databases: country override (ISO code, '' = detect automatically)
addColumn(db, 'servers', 'country', "TEXT NOT NULL DEFAULT ''");

// older databases: add the column once
addColumn(db, 'servers', 'display_address', "TEXT NOT NULL DEFAULT ''");

// versioned migrations (v1 = everything above); a copy of an existing database is made first, see migrations.ts
runMigrations(db, { dataDir: DATA_DIR, existing: hadSchema });

/** Title shown for a server: the custom name if set, otherwise the name the game server reports, otherwise host:port. */
export const EFFECTIVE_NAME = "COALESCE(NULLIF(s.name, ''), NULLIF(st.name, ''), NULLIF(s.display_address, ''), s.host || ':' || s.port)";

const warnedSecrets = new Set<string>();

/** Secret settings (see secrets.ts) are decrypted here; one that cannot be decrypted reads as "not set". */
export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return null;
  if (!isSecretKey(key)) return row.value;
  try {
    return decryptSecret(row.value);
  } catch (e) {
    if (!warnedSecrets.has(key)) {
      warnedSecrets.add(key);
      log.error(`setting "${key}" cannot be decrypted (${(e as Error).message}); enter it again in the panel`);
    }
    return null;
  }
}

/** value === null (or empty string) deletes the setting; secret keys are stored encrypted */
export function setSetting(key: string, value: string | null): void {
  if (value === null || value === '') db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else {
    warnedSecrets.delete(key);
    const stored = isSecretKey(key) ? encryptSecret(value) : value;
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, stored);
  }
}

/** Secret settings whose stored value cannot be decrypted with the current key. */
export function undecryptableSecrets(): string[] {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  return rows.filter((r) => isSecretKey(r.key) && isEncrypted(r.value) && !canDecrypt(r.value)).map((r) => r.key);
}

// secrets stored in plaintext by older versions are encrypted once, and values written with the old JWT_SECRET-derived
// key are written again with SECRETS_KEY (idempotent: rows that already use the current key are skipped)
try {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const upd = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  db.transaction(() => {
    for (const r of rows) {
      if (!isSecretKey(r.key) || r.value === '') continue;
      if (!isEncrypted(r.value)) upd.run(encryptSecret(r.value), r.key);
      else if (usesLegacyKey(r.value)) upd.run(reencrypt(r.value), r.key);
    }
  })();
} catch (e) {
  // no key at all: config.ts stops with a clear message when it loads
  log.error('secrets migration skipped:', (e as Error).message);
}
if (restoredNow) {
  const lost = undecryptableSecrets();
  if (lost.length) {
    log.error(`restored backup: these secrets were encrypted with another key and are unreadable: ${lost.join(', ')}`);
    db.prepare('INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)').run(
      Date.now(),
      'система',
      'Копия восстановлена, но часть секретов не расшифрована (другой SECRETS_KEY/JWT_SECRET): введите их заново',
      lost.join(', '),
    );
  }
}

export interface ServerRow {
  id: number;
  sort_order?: number | null;
  /** address shown to people (public IP or domain); '' = show host:port */
  display_address: string;
  /** country shown in Discord (ISO 3166-1 alpha-2); '' = detected from the IP */
  country: string;
  name: string;
  game: string;
  host: string;
  port: number;
  query_port: number | null;
  created_at: number;
}

export interface StatusRow {
  server_id: number;
  online: number;
  name: string | null;
  players: number;
  max_players: number;
  map: string | null;
  version: string | null;
  ping: number | null;
  player_names: string;
  error: string | null;
  updated_at: number;
  /** when the server entered its current state (online/offline) */
  state_since: number | null;
}

export interface BindingRow {
  id: number;
  server_id: number;
  channel_id: string;
  message_id: string | null;
  interval_sec: number;
  enabled: number;
  last_update: number | null;
  last_error: string | null;
  /** how the message looks in Discord: embed (default), card (PNG) or both */
  style: string;
  /** more servers shown in the same message (JSON array of server ids; the main one is server_id) */
  extra_ids: string;
}
