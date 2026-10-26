/**
 * Health history: a sample every 5 minutes (database size, memory, poll duration, bot state, queue length, free disk),
 * kept 14 days, and the "flags" derived from it (bot offline, slow poll, low disk, fast-growing database).
 */
import type { Express, RequestHandler } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import { z } from 'zod';
import { DATA_DIR, db, getSetting, setSetting } from './db.js';
import { failThreshold, lastPollStats, pollConcurrency } from './gsm.js';
import { log } from './logger.js';

const DB_PATH = process.env.DB_PATH ?? './data/coregsm.db';
const SAMPLE_EVERY_MS = 5 * 60_000;
const KEEP_MS = 14 * 24 * 3600_000;

export interface BotInfo {
  state: string;
  updatedAt: number;
}
let getBot: (() => BotInfo) | null = null;

export interface Sample {
  ts: number;
  dbBytes: number;
  rssMb: number;
  pollMs: number;
  pollFailures: number;
  botState: string;
  queueLen: number;
  diskFree: number | null;
  /** 1-minute load average per core, percent (absent: not measured) */
  loadPct?: number | null;
}

export interface Flag {
  kind: 'bot_offline' | 'poll_slow' | 'disk_low' | 'db_growing';
  since: number;
  text: string;
}

const dbSize = (): number => {
  try {
    return fs.statSync(DB_PATH).size;
  } catch {
    return 0;
  }
};
const diskFree = (): number | null => {
  try {
    const st = fs.statfsSync(DATA_DIR);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return null;
  }
};
const queueLen = (): number => {
  try {
    return (db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE status IN ('queued', 'sending')").get() as { c: number }).c;
  } catch {
    return 0;
  }
};

/** 'none' (no token), 'online', 'offline' (not answering), or the bot's own state (connecting, error, ...) */
export function botStateNow(now = Date.now()): string {
  const tokenSet = !!getSetting('discord_token');
  if (!tokenSet) return 'none';
  if (!getBot) return 'unknown';
  const b = getBot();
  if (now - b.updatedAt > 45_000) return 'offline';
  return b.state || 'unknown';
}
const botBad = (s: string) => s === 'offline' || s === 'error';

/** the processor load: 1-minute load average divided by the cores (0 where the system has no load average) */
export const loadPctNow = (): number => Math.round((os.loadavg()[0] / Math.max(1, os.cpus().length)) * 1000) / 10;

export function sampleNow(now = Date.now()): Sample {
  const p = lastPollStats();
  return {
    ts: now,
    dbBytes: dbSize(),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    pollMs: p.durationMs ?? 0,
    pollFailures: p.failures,
    botState: botStateNow(now),
    queueLen: queueLen(),
    diskFree: diskFree(),
    loadPct: loadPctNow(),
  };
}

export function recordSample(now = Date.now()): Sample {
  const s = sampleNow(now);
  db.prepare(
    'INSERT OR REPLACE INTO health_samples (ts, db_bytes, rss_mb, poll_ms, poll_failures, bot_state, queue_len, disk_free, load_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(s.ts, s.dbBytes, s.rssMb, s.pollMs, s.pollFailures, s.botState, s.queueLen, s.diskFree, s.loadPct ?? null);
  db.prepare('DELETE FROM health_samples WHERE ts < ?').run(now - KEEP_MS);
  return s;
}

interface Row {
  ts: number;
  db_bytes: number;
  rss_mb: number;
  poll_ms: number;
  poll_failures: number;
  bot_state: string;
  queue_len: number;
  disk_free: number | null;
  load_pct: number | null;
}
const toSample = (r: Row): Sample => ({
  ts: r.ts,
  dbBytes: r.db_bytes,
  rssMb: r.rss_mb,
  pollMs: r.poll_ms,
  pollFailures: r.poll_failures,
  botState: r.bot_state,
  queueLen: r.queue_len,
  diskFree: r.disk_free,
  loadPct: r.load_pct,
});

export function samplesSince(since: number): Sample[] {
  return (db.prepare('SELECT * FROM health_samples WHERE ts >= ? ORDER BY ts').all(since) as Row[]).map(toSample);
}

const MB = 1048576;
const GB = 1073741824;

/** start of the trailing run of samples for which `bad` holds (oldest first input); the live state counts as the newest */
function runStart(samples: Sample[], bad: (s: Sample) => boolean, now: number): number {
  let since = now;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (!bad(samples[i])) break;
    since = samples[i].ts;
  }
  return since;
}

/**
 * Pure: flags for the given samples (oldest first) and the live state `cur`.
 * pollMs = poll interval (a poll that takes most of it is "slow").
 */
export function computeFlags(samples: Sample[], cur: Sample, pollMs: number, now = Date.now()): Flag[] {
  const flags: Flag[] = [];
  const all = [...samples.filter((s) => s.ts < cur.ts), cur];

  if (botBad(cur.botState)) {
    flags.push({
      kind: 'bot_offline',
      since: runStart(all, (s) => botBad(s.botState), now),
      text: cur.botState === 'offline' ? 'Discord-бот не отвечает' : 'Discord-бот сообщает об ошибке',
    });
  }

  const slowLimit = Math.max(5000, pollMs * 0.8);
  if (cur.pollMs > slowLimit) {
    flags.push({
      kind: 'poll_slow',
      since: runStart(all, (s) => s.pollMs > slowLimit, now),
      text: `Опрос серверов идёт ${Math.round(cur.pollMs / 1000)} с при интервале ${Math.round(pollMs / 1000)} с`,
    });
  }

  if (cur.diskFree != null && cur.diskFree < GB) {
    flags.push({
      kind: 'disk_low',
      since: runStart(all, (s) => s.diskFree != null && s.diskFree < GB, now),
      text: `На диске осталось ${(cur.diskFree / GB).toFixed(1)} ГБ`,
    });
  }

  // the database grew by half and by at least 50 MB over the last 7 days (needs a day of samples)
  const week = all.filter((s) => s.ts >= now - 7 * 24 * 3600_000 && s.dbBytes > 0);
  if (week.length >= 2) {
    const first = week[0];
    const grown = cur.dbBytes - first.dbBytes;
    if (cur.ts - first.ts >= 24 * 3600_000 && grown >= 50 * MB && cur.dbBytes >= first.dbBytes * 1.5) {
      flags.push({
        kind: 'db_growing',
        since: first.ts,
        text: `База данных выросла на ${Math.round(grown / MB)} МБ за ${Math.max(1, Math.round((cur.ts - first.ts) / 86_400_000))} сут.`,
      });
    }
  }
  return flags;
}

/** the limits the flags use, so a chart can draw them */
export function thresholds(): { pollIntervalMs: number; pollSlowMs: number; diskLowBytes: number } {
  const iv = pollIntervalMs();
  return { pollIntervalMs: iv, pollSlowMs: Math.max(5000, iv * 0.8), diskLowBytes: GB };
}

const pollIntervalMs = () => Number(process.env.POLL_INTERVAL_SEC ?? 30) * 1000 || 30_000;

/** flags right now (added to GET /api/system) */
export function currentFlags(now = Date.now()): Flag[] {
  try {
    return computeFlags(samplesSince(now - 7 * 24 * 3600_000), sampleNow(now), pollIntervalMs(), now);
  } catch (e) {
    log.error('health flags failed', (e as Error).message);
    return [];
  }
}

export function registerHealth({ app, admin, bot }: { app: Express; admin: RequestHandler; bot: () => BotInfo }): void {
  getBot = bot;

  const pollPayload = () => ({ failThreshold: failThreshold(), concurrency: pollConcurrency(), last: lastPollStats() });
  app.get('/api/settings/poll', admin, (_req, res) => res.json(pollPayload()));
  app.put('/api/settings/poll', admin, (req, res) => {
    const b = z
      .object({ failThreshold: z.number().int().min(1).max(5).optional(), concurrency: z.number().int().min(1).max(32).optional() })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Подтверждение недоступности: от 1 до 5 опросов, параллельность: от 1 до 32' });
    if (b.data.failThreshold !== undefined) setSetting('poll_fail_threshold', String(b.data.failThreshold));
    if (b.data.concurrency !== undefined) setSetting('poll_concurrency', String(b.data.concurrency));
    res.json(pollPayload());
  });
  app.get('/api/system/health-history', admin, (req, res) => {
    const hours = Math.min(336, Math.max(1, Math.floor(Number(req.query.hours ?? 24)) || 24));
    const now = Date.now();
    // first look before the first scheduled sample: take one now so the chart is never empty
    if (!(db.prepare('SELECT 1 FROM health_samples LIMIT 1').get())) recordSample(now);
    res.json({ samples: samplesSince(now - hours * 3600_000), flags: currentFlags(now), thresholds: thresholds() });
  });
  const tick = () => {
    try {
      recordSample();
    } catch (e) {
      log.error('health sample failed', (e as Error).message);
    }
  };
  setTimeout(tick, 20_000).unref();
  setInterval(tick, SAMPLE_EVERY_MS).unref();
}
