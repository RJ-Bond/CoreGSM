import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

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
      for (const f of fs.readdirSync(DATA_DIR)) if (/^brand-logo\.(png|jpg|webp)$/.test(f)) fs.rmSync(path.join(DATA_DIR, f), { force: true });
      for (const f of fs.readdirSync(pendingDir)) if (/^brand-logo\.(png|jpg|webp)$/.test(f)) fs.copyFileSync(path.join(pendingDir, f), path.join(DATA_DIR, f));
    }
    restoredNow = true;
    console.log('Database restored from the uploaded backup (the previous one is kept as .before-restore)');
  } catch (e) {
    console.error('Restore failed:', (e as Error).message);
  }
  // never retry a half-done restore on every start
  fs.rmSync(pendingDir, { recursive: true, force: true });
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// SQLite lower()/NOCASE only fold ASCII: logins in any alphabet are compared with this
db.function('ulower', { deterministic: true }, (s) => String(s).toLowerCase());

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
try {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
} catch {
  /* column already exists */
}
try {
  db.exec('ALTER TABLE users ADD COLUMN created_at INTEGER');
} catch {
  /* column already exists */
}

// accounts: approval status, linked Discord account, sessions
for (const ddl of [
  "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
  'ALTER TABLE users ADD COLUMN discord_id TEXT',
  'ALTER TABLE users ADD COLUMN discord_name TEXT',
  'ALTER TABLE users ADD COLUMN discord_avatar TEXT',
  'ALTER TABLE users ADD COLUMN no_password INTEGER NOT NULL DEFAULT 0',
]) {
  try {
    db.exec(ddl);
  } catch {
    /* column already exists */
  }
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
try {
  db.exec('ALTER TABLE history ADD COLUMN ping INTEGER');
} catch {
  /* column already exists */
}
// a restored database starts with nobody signed in
if (restoredNow) {
  db.prepare('DELETE FROM sessions').run();
  // the restored database has no record of the restore itself
  db.prepare('INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)').run(Date.now(), 'система', 'Панель восстановлена из резервной копии', '');
}

// older databases: new columns are added once
try {
  db.exec("ALTER TABLE bindings ADD COLUMN style TEXT NOT NULL DEFAULT 'embed'");
} catch {
  /* column already exists */
}

// older databases: country override (ISO code, '' = detect automatically)
try {
  db.exec("ALTER TABLE servers ADD COLUMN country TEXT NOT NULL DEFAULT ''");
} catch {
  /* column already exists */
}

// older databases: add the column once
try {
  db.exec("ALTER TABLE servers ADD COLUMN display_address TEXT NOT NULL DEFAULT ''");
} catch {
  /* column already exists */
}

/** Title shown for a server: the custom name if set, otherwise the name the game server reports, otherwise host:port. */
export const EFFECTIVE_NAME = "COALESCE(NULLIF(s.name, ''), NULLIF(st.name, ''), NULLIF(s.display_address, ''), s.host || ':' || s.port)";

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

/** value === null (or empty string) deletes the setting */
export function setSetting(key: string, value: string | null): void {
  if (value === null || value === '') db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export interface ServerRow {
  id: number;
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
}
