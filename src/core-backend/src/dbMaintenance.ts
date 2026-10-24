/**
 * Keeps the SQLite file healthy without anybody looking at it:
 *  - every 15 minutes the write-ahead log is folded back into the database and truncated, so the -wal file does not grow
 *    for weeks next to a busy poller (it is only checkpointed automatically while no reader holds it back);
 *  - every 6 hours (and once shortly after the start) `PRAGMA optimize` refreshes the planner statistics.
 * Both are cheap and never lock readers for long. A full VACUUM is left out on purpose: it rewrites the file under an
 * exclusive lock; `coregsm backup` and the migrations already make consistent copies with VACUUM INTO.
 */
import { db } from './db.js';
import { log } from './logger.js';

export interface MaintenanceResult {
  /** frames the checkpoint wrote; null when the checkpoint could not run */
  checkpointed: number | null;
  /** the checkpoint did not finish because a reader was still using the log */
  busy: boolean;
}

export function checkpointWal(): MaintenanceResult {
  try {
    const r = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number; checkpointed: number }[];
    return { checkpointed: r[0]?.checkpointed ?? 0, busy: !!r[0]?.busy };
  } catch (e) {
    log.error('wal checkpoint failed', (e as Error).message);
    return { checkpointed: null, busy: false };
  }
}

export function optimizeDb(): boolean {
  try {
    db.pragma('optimize');
    return true;
  } catch (e) {
    log.error('db optimize failed', (e as Error).message);
    return false;
  }
}

export function startDbMaintenance(): void {
  setInterval(checkpointWal, 15 * 60_000).unref();
  setInterval(optimizeDb, 6 * 3600_000).unref();
  setTimeout(optimizeDb, 60_000).unref();
}
