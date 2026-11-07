/**
 * The restart timers of game servers, as rows of the database (one per server). A small module on purpose: the plugin
 * poll in gameNews.ts has to ask «is a restart due?» without importing the module that talks to the chat.
 *
 * state: counting (the chat is told how long is left) -> due (the time is up, waiting for the plugin to ask) -> sent
 *        (the plugin was told to restart); cancelled / missed (the plugin did not ask within three minutes) end a timer.
 */
import { db } from '../db.js';

export type JobState = 'counting' | 'due' | 'sent' | 'cancelled' | 'missed';

export interface Job {
  server_id: number;
  run_at: number;
  started_at: number;
  total_sec: number;
  last_notice: number;
  requested_by: string;
  source: string;
  state: JobState;
}

/** a due restart that the plugin has not asked for in this time is dropped (the plugin is off or the panel was away) */
export const DUE_GRACE_MS = 3 * 60_000;

export const getJob = (serverId: number): Job | undefined =>
  db.prepare('SELECT * FROM game_restart_jobs WHERE server_id = ?').get(serverId) as Job | undefined;

export function saveJob(j: Job): void {
  db.prepare(
    `INSERT INTO game_restart_jobs (server_id, run_at, started_at, total_sec, last_notice, requested_by, source, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id) DO UPDATE SET run_at = excluded.run_at, started_at = excluded.started_at, total_sec = excluded.total_sec,
       last_notice = excluded.last_notice, requested_by = excluded.requested_by, source = excluded.source, state = excluded.state`,
  ).run(j.server_id, j.run_at, j.started_at, j.total_sec, j.last_notice, j.requested_by, j.source, j.state);
}

export const setState = (serverId: number, state: JobState): void => {
  db.prepare('UPDATE game_restart_jobs SET state = ? WHERE server_id = ?').run(state, serverId);
};

// ---- the history: one row per started timer
export type Outcome = 'counting' | 'done' | 'cancelled' | 'missed' | 'replaced';
const KEEP_LOG = 200;

export function logStart(j: Job): void {
  closeLog(j.server_id, 'replaced', j.started_at);
  db.prepare('INSERT INTO game_restart_log (server_id, started_at, run_at, total_sec, requested_by, source, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(j.server_id, j.started_at, j.run_at, j.total_sec, j.requested_by, j.source, 'counting');
  db.prepare('DELETE FROM game_restart_log WHERE id NOT IN (SELECT id FROM game_restart_log ORDER BY id DESC LIMIT ?)').run(KEEP_LOG);
}

/** the running row of the server ends with this outcome */
export function closeLog(serverId: number, outcome: Outcome, now: number): void {
  db.prepare("UPDATE game_restart_log SET outcome = ?, finished_at = ? WHERE server_id = ? AND outcome = 'counting'").run(outcome, now, serverId);
}

export function logRunAt(serverId: number, runAt: number): void {
  db.prepare("UPDATE game_restart_log SET run_at = ? WHERE server_id = ? AND outcome = 'counting'").run(runAt, serverId);
}

export interface LogRow { id: number; server_id: number; started_at: number; run_at: number; total_sec: number; requested_by: string; source: string; outcome: Outcome; finished_at: number | null }
export const recentLog = (limit = 12): LogRow[] =>
  db.prepare('SELECT * FROM game_restart_log ORDER BY id DESC LIMIT ?').all(limit) as LogRow[];

export const setLastNotice = (serverId: number, last: number): void => {
  db.prepare('UPDATE game_restart_jobs SET last_notice = ? WHERE server_id = ?').run(last, serverId);
};

export const jobsIn = (...states: JobState[]): Job[] =>
  db.prepare(`SELECT * FROM game_restart_jobs WHERE state IN (${states.map(() => '?').join(',')})`).all(...states) as Job[];

/** the plugin of this server asks: true once when the time is up (the job becomes «sent»), so that a restart is ordered only once */
export function consumeDue(serverId: number): boolean {
  const j = getJob(serverId);
  if (!j || j.state !== 'due') return false;
  setState(serverId, 'sent');
  closeLog(serverId, 'done', Date.now());
  return true;
}
