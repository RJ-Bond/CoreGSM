/** Schema helpers shared by db.ts, the modules that own a table, and migrations.ts. */
import type Database from 'better-sqlite3';

type Db = InstanceType<typeof Database>;

export const hasTable = (db: Db, t: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
export const hasColumn = (db: Db, t: string, c: string): boolean => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((x) => x.name === c);

/**
 * Adds a column once. Unlike `try { ALTER TABLE ... } catch {}` it asks the table first, so only "the column is
 * already there" is skipped: a missing table or a bad definition still stops the start with its real error.
 */
export function addColumn(db: Db, table: string, column: string, ddl: string): void {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
