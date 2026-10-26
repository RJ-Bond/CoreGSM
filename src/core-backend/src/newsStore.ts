/** News storage: tables, columns and the delivery-retry hook. Importing this module creates them. */
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { registerKind } from './deliveries.js';
import { addColumn } from './schema.js';

export const IMG_DIR = path.join(path.dirname(process.env.DB_PATH ?? './data/coregsm.db'), 'news');
fs.mkdirSync(IMG_DIR, { recursive: true });

db.exec(`
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  scheduled_at INTEGER,
  sent_at INTEGER,
  message_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

addColumn(db, 'news', 'repeat', "TEXT NOT NULL DEFAULT 'none'");
// delivery retries: failed attempts so far and the earliest time of the next one (see deliveries.ts)
addColumn(db, 'news', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
addColumn(db, 'news', 'next_try_at', 'INTEGER');
// a manual retry from the deliveries list puts the item back into the queue it came from
registerKind('news', {
  retry(refId, payload) {
    const q = payload.action === 'edit' ? 'edit_queued' : payload.action === 'delete' ? 'delete_queued' : 'queued';
    db.prepare("UPDATE news SET status = ?, attempts = 0, next_try_at = NULL, error = NULL, updated_at = ? WHERE id = ? AND test = 0").run(q, Date.now(), refId);
  },
});

// 1 = a test send (never shown in lists, cleaned up after an hour)
addColumn(db, 'news', 'test', 'INTEGER NOT NULL DEFAULT 0');

// the user who created the item (its role is resolved at read time, see authorRole)
addColumn(db, 'news', 'created_by', 'INTEGER');

db.exec(`
CREATE TABLE IF NOT EXISTS news_reactions (
  news_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (news_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_news_reactions_news ON news_reactions (news_id);
CREATE TABLE IF NOT EXISTS news_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  news_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  payload TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_news_versions_news ON news_versions (news_id, id);
CREATE TABLE IF NOT EXISTS news_autosave (
  user_key TEXT NOT NULL,
  key TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_key, key)
);
`);

export interface NewsRow {
  repeat: string;
  id: number;
  test?: number;
  status: string;
  channel_id: string;
  payload: string;
  scheduled_at: number | null;
  sent_at: number | null;
  message_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  created_by?: number | null;
}
