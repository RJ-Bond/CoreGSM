import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DB_PATH ?? './data/coregsm.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

// older databases: new columns are added once
try {
  db.exec("ALTER TABLE bindings ADD COLUMN style TEXT NOT NULL DEFAULT 'embed'");
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
