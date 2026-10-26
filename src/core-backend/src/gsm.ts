import { trackAlerts } from './alerts.js';
import { trackSmart } from './smartAlerts.js';
import { onPollResult } from './subscriptions.js';
import { onFavoritePoll } from './favoritePush.js';
import { onSessionsOpened } from './nickOnboarding.js';
import { notifyFollowers } from './playerFollows.js';
import { maintenanceFor as maintenanceNow } from './maintenance.js';
import { db, getSetting, type ServerRow } from './db.js';
import { inMaintenance, pruneMaintenance } from './maintenance.js';
import { clampConcurrency, clampDays, clampThreshold, decideStatus, DEFAULT_CONCURRENCY, pruneDue, RETENTION_DEFAULTS, runPool } from './pollLogic.js';

export { humanizeQueryError, queryServer, type QueryResult } from './query.js';
import { queryServer, type QueryResult } from './query.js';
import { log } from './logger.js';

const upsert = db.prepare(`
INSERT INTO status (server_id, online, name, players, max_players, map, version, ping, player_names, error, updated_at, consecutive_failures, state_since)
VALUES (@id, @online, @name, @players, @max, @map, @version, @ping, @names, @error, @ts, @failures, @ts)
ON CONFLICT(server_id) DO UPDATE SET
  online=excluded.online, name=COALESCE(excluded.name, status.name), players=excluded.players, max_players=excluded.max_players,
  map=excluded.map, version=excluded.version, ping=excluded.ping, player_names=excluded.player_names,
  error=excluded.error, updated_at=excluded.updated_at, consecutive_failures=excluded.consecutive_failures,
  state_since=CASE WHEN status.online = excluded.online AND status.state_since IS NOT NULL THEN status.state_since ELSE excluded.updated_at END
`);
const addHistory = db.prepare('INSERT INTO history (server_id, ts, online, players, ping, unconfirmed, maint) VALUES (?, ?, ?, ?, ?, ?, ?)');
// compiled once: these run for every server on every poll
const nowNames = db.prepare('SELECT name FROM player_now WHERE server_id = ?');
const nowClear = db.prepare('DELETE FROM player_now WHERE server_id = ?');
const nowDelete = db.prepare('DELETE FROM player_now WHERE server_id = ? AND name = ?');
const nowInsert = db.prepare('INSERT OR IGNORE INTO player_now (server_id, name, since) VALUES (?, ?, ?)');
const sessOpen = db.prepare('SELECT id, name FROM player_sessions WHERE server_id = ? AND left_at IS NULL');
const sessClose = db.prepare('UPDATE player_sessions SET left_at = ? WHERE id = ?');
const sessInsert = db.prepare('INSERT INTO player_sessions (server_id, name, joined_at) VALUES (?, ?, ?)');

/**
 * Keeps player_now in step with the latest poll: names that left are removed, new ones get since = now.
 * A failed/offline poll clears the server's rows. Names are capped at 200.
 */
export function syncPlayersNow(serverId: number, names: string[], online: boolean, now: number): void {
  db.transaction(() => {
    if (!online) {
      nowClear.run(serverId);
      return;
    }
    const current = new Set(names.slice(0, 200));
    const have = nowNames.all(serverId) as { name: string }[];
    for (const h of have) if (!current.has(h.name)) nowDelete.run(serverId, h.name);
    for (const n of current) nowInsert.run(serverId, n, now);
  })();
}

/**
 * Player visit log: a session opens when a name appears in the poll and closes when it disappears
 * (or when the server goes offline). Names are compared case-insensitively; empty and duplicate names are ignored.
 */
export function syncPlayerSessions(serverId: number, names: string[], online: boolean, now: number): string[] {
  const opened: string[] = [];
  db.transaction(() => {
    const open = sessOpen.all(serverId) as { id: number; name: string }[];
    if (!online) {
      for (const o of open) sessClose.run(now, o.id);
      return;
    }
    const current = new Map<string, string>();
    for (const raw of names.slice(0, 200)) {
      const n = String(raw ?? '').trim().slice(0, 64);
      if (n && !current.has(n.toLowerCase())) current.set(n.toLowerCase(), n);
    }
    const stillOpen = new Set<string>();
    for (const o of open) {
      const k = o.name.toLowerCase();
      // gone from the list, or a duplicate row left over from an earlier run
      if (!current.has(k) || stillOpen.has(k)) sessClose.run(now, o.id);
      else stillOpen.add(k);
    }
    for (const [k, n] of current) {
      if (stillOpen.has(k)) continue;
      sessInsert.run(serverId, n, now);
      opened.push(n);
    }
  })();
  return opened;
}

/**
 * Daily counters for the status page (UTC day). `count` polls are added at once (a confirmed outage adds the polls
 * that were held back). With `peakOnly` the poll does not count (maintenance), only the peak is kept.
 */
export function recordUptime(serverId: number, online: boolean, players: number, ts: number, opts: { count?: number; peakOnly?: boolean } = {}): void {
  const day = new Date(ts).toISOString().slice(0, 10);
  const n = opts.peakOnly ? 0 : Math.max(1, opts.count ?? 1);
  const peak = online ? Math.max(0, players) : 0;
  db.prepare(
    `INSERT INTO uptime_daily (server_id, day, up, total, peak) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(server_id, day) DO UPDATE SET up = up + excluded.up, total = total + excluded.total, peak = MAX(peak, excluded.peak)`,
  ).run(serverId, day, online ? n : 0, n, peak);
}

// ---------- settings ----------
/** consecutive failed polls before a server is shown as offline (setting poll_fail_threshold, 1..5, default 2) */
export const failThreshold = (): number => clampThreshold(getSetting('poll_fail_threshold'));
/** servers polled at the same time (setting poll_concurrency, else env POLL_CONCURRENCY, 1..32, default 8) */
export const pollConcurrency = (): number => {
  const s = getSetting('poll_concurrency');
  return clampConcurrency(s !== null && s !== '' ? s : process.env.POLL_CONCURRENCY);
};

export interface PollOutcome {
  /** the poll itself reached the server */
  polledOnline: boolean;
  /** state now stored in `status` */
  online: boolean;
  /** false: failure not confirmed yet, last good state kept */
  confirmed: boolean;
  failures: number;
}

/**
 * Stores one poll result (the synchronous half of refreshServer; exported for tests).
 * `debounce`: a failed poll only counts after `poll_fail_threshold` consecutive failures (the scheduled poller).
 * Without it (manual refresh, a server just added or edited) the result stands at once.
 */
export function applyPollResult(s: ServerRow, r: QueryResult, ts: number, opts: { debounce?: boolean } = {}): PollOutcome {
  const prev = db.prepare('SELECT online, players, consecutive_failures AS f FROM status WHERE server_id = ?').get(s.id) as
    | { online: number; players: number; f: number }
    | undefined;
  const d = decideStatus({
    prevOnline: prev ? !!prev.online : null,
    prevFailures: prev?.f ?? 0,
    polledOnline: r.online,
    threshold: opts.debounce ? failThreshold() : 1,
  });
  const maint = inMaintenance(s.id, ts) ? 1 : 0;
  const outcome: PollOutcome = { polledOnline: r.online, online: d.online, confirmed: d.confirmed, failures: d.failures };

  if (!d.confirmed) {
    // not believed yet: the last good state stays, the sample is marked so that uptime ignores it
    db.prepare('UPDATE status SET consecutive_failures = ?, updated_at = ? WHERE server_id = ?').run(d.failures, ts, s.id);
    addHistory.run(s.id, ts, 1, prev?.players ?? 0, null, 1, maint);
    return outcome;
  }

  upsert.run({
    id: s.id,
    online: d.online ? 1 : 0,
    name: r.name,
    players: r.players,
    max: r.maxPlayers,
    map: r.map,
    version: r.version,
    ping: r.ping,
    names: JSON.stringify(r.playerNames.slice(0, 50)),
    error: r.error,
    ts,
    failures: d.failures,
  });
  addHistory.run(s.id, ts, d.online ? 1 : 0, r.players, r.ping, 0, maint);
  if (d.becameOffline) {
    // the outage began with the first failed poll: the held-back samples become offline ones
    db.prepare('UPDATE history SET online = 0, players = 0, unconfirmed = 0 WHERE server_id = ? AND unconfirmed = 1').run(s.id);
  }
  try {
    syncPlayersNow(s.id, r.playerNames, d.online, ts);
    const opened = syncPlayerSessions(s.id, r.playerNames, d.online, ts);
    onSessionsOpened(s.id, opened, ts);
    notifyFollowers(s.id, opened, ts);
    if (maint) recordUptime(s.id, d.online, r.players, ts, { peakOnly: true });
    else recordUptime(s.id, d.online, r.players, ts, { count: d.becameOffline ? d.failures : 1 });
  } catch (e) {
    log.error('player/uptime bookkeeping failed', (e as Error).message);
  }
  try {
    trackAlerts(s.id, d.online, r.error);
    // smart alerts measure a working server; planned work is not a symptom
    if (!maint) trackSmart(s.id, { online: d.online, players: r.players, maxPlayers: r.maxPlayers, ping: r.ping }, ts);
  } catch (e) {
    log.error('alerts failed', (e as Error).message);
  }
  try {
    // planned work: nobody is told that the server went down (free-slot notices still make sense, back_online follows the window)
    if (!(!d.online && maintenanceNow(s.id))) onPollResult(s.id, { online: d.online, players: r.players, maxPlayers: r.maxPlayers });
  } catch (e) {
    log.error('subscriptions failed', (e as Error).message);
  }
  // push to the players who have this server in favourites (fire and forget, never throws)
  onFavoritePoll(s.id, { online: d.online, players: r.players, maxPlayers: r.maxPlayers }, { muteDown: !d.online && !!maintenanceNow(s.id), now: ts });
  return outcome;
}

export async function refreshServer(s: ServerRow, opts: { debounce?: boolean } = {}): Promise<PollOutcome | null> {
  const r = await queryServer(s);
  const ts = Date.now();
  // the server may have been deleted while the query was running
  const still = db.prepare('SELECT 1 FROM servers WHERE id = ?').get(s.id);
  if (!still) return null;
  return applyPollResult(s, r, ts, opts);
}

// ---------- scheduler ----------
export interface PollStats {
  at: number | null;
  durationMs: number | null;
  servers: number;
  failures: number;
  concurrency: number;
}
let lastStats: PollStats = { at: null, durationMs: null, servers: 0, failures: 0, concurrency: DEFAULT_CONCURRENCY };
/** the last finished poll cycle: when, how long, how many servers did not answer */
export const lastPollStats = (): PollStats => ({ ...lastStats });

/**
 * Days to keep each kind of old rows. Set HISTORY_DAYS, PLAYER_SESSIONS_DAYS, ACCOUNT_EVENTS_DAYS and UPTIME_DAYS in
 * .env to change them (1..3650); the defaults are 30, 90, 180 and 90.
 */
export const retentionDays = () => ({
  history: clampDays(process.env.HISTORY_DAYS, RETENTION_DEFAULTS.history),
  playerSessions: clampDays(process.env.PLAYER_SESSIONS_DAYS, RETENTION_DEFAULTS.playerSessions),
  accountEvents: clampDays(process.env.ACCOUNT_EVENTS_DAYS, RETENTION_DEFAULTS.accountEvents),
  uptime: clampDays(process.env.UPTIME_DAYS, RETENTION_DEFAULTS.uptime),
});

const DAY = 24 * 3600 * 1000;
/** deletes the rows older than their retention; exported for tests */
export function pruneOld(now = Date.now()): void {
  const r = retentionDays();
  db.prepare('DELETE FROM history WHERE ts < ?').run(now - r.history * DAY);
  db.prepare('DELETE FROM player_sessions WHERE left_at IS NOT NULL AND left_at < ?').run(now - r.playerSessions * DAY);
  db.prepare('DELETE FROM account_events WHERE ts < ?').run(now - r.accountEvents * DAY);
  db.prepare('DELETE FROM uptime_daily WHERE day < ?').run(new Date(now - r.uptime * DAY).toISOString().slice(0, 10));
  pruneMaintenance();
}
let lastPrune = 0;

let running = false;
let stopping = false;
let pollTimer: NodeJS.Timeout | undefined;
let jitterMaxMs = 1500;
let pollCount = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function pollAll(): Promise<void> {
  if (running || stopping) return;
  running = true;
  try {
    const t0 = Date.now();
    const servers = db.prepare('SELECT * FROM servers').all() as ServerRow[];
    const concurrency = pollConcurrency();
    let failures = 0;
    await runPool(servers, concurrency, async (s) => {
      // servers do not all start at the same instant
      if (jitterMaxMs > 0) await sleep(Math.floor(Math.random() * jitterMaxMs));
      // shutting down: the servers not queried yet wait for the next start
      if (stopping) return;
      try {
        const o = await refreshServer(s, { debounce: true });
        if (o && !o.polledOnline) failures++;
      } catch (e) {
        failures++;
        log.error(`poll of server ${s.id} failed`, (e as Error).message);
      }
    });
    const durationMs = Date.now() - t0;
    lastStats = { at: Date.now(), durationMs, servers: servers.length, failures, concurrency };
    pollCount++;
    // quiet when all is well: the first poll, slow polls, polls with failures and every 20th
    if (servers.length && (pollCount === 1 || failures > 0 || durationMs > 5000 || pollCount % 20 === 0)) {
      log.info(`poll #${pollCount}: ${servers.length} servers, ${failures} failed, ${durationMs} ms (concurrency ${concurrency})`);
    }
    // old rows are deleted once an hour, not after every 30-second cycle; set before the work so a failure is not retried at once
    if (pruneDue(Date.now(), lastPrune)) {
      lastPrune = Date.now();
      pruneOld();
    }
  } catch (e) {
    // a database or disk error must not become an unhandled rejection (the timer calls pollAll with `void`)
    log.error('poll cycle failed', (e as Error).message);
  } finally {
    running = false;
  }
}

export function startPoller(intervalMs: number): void {
  jitterMaxMs = Math.min(1500, Math.max(0, Math.floor(intervalMs / 10)));
  void pollAll();
  pollTimer = setInterval(() => void pollAll(), intervalMs);
  pollTimer.unref();
}

/** Shutdown: no new poll cycles, the running one skips the servers it has not started and is awaited. */
export async function stopPoller(): Promise<void> {
  stopping = true;
  clearInterval(pollTimer);
  while (running) await sleep(50);
}
