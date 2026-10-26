/**
 * Delivery ledger and queue for everything the Discord bot has to send.
 *
 *   kind 'alert' | 'dm'   -> this table IS the queue (the bot polls /internal/deliveries/pending)
 *   kind 'news' | 'status' -> the table is a ledger: the queue stays in its own table (news), and every
 *                             attempt is mirrored here so the administrator sees attempts and errors in one place
 *
 * Row life: pending (never tried) -> sending (claimed by the bot) -> sent
 *                                  -> error (failed, a retry is scheduled at next_try_at) -> ... -> dead
 * Backoff after the n-th failed attempt: 30 s, 1, 2, 5, 15 min (15 min from then on); after 8 attempts the row is dead.
 * A dead row can be retried by an administrator (POST /api/deliveries/:id/retry).
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { db } from './db.js';

export type DeliveryKind = 'news' | 'alert' | 'dm' | 'status';
export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'error' | 'dead';

export const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 900_000] as const;
export const MAX_ATTEMPTS = 8;
/** a claimed delivery that was never reported is handed out again after this long */
const CLAIM_TIMEOUT_MS = 2 * 60_000;

db.exec(`
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref_id INTEGER,
  target TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  claimed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_deliveries_due ON deliveries(status, next_try_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_ref ON deliveries(kind, ref_id);
`);

/** Delay before the next try after `attempts` failed attempts (1-based). */
export function backoffMs(attempts: number): number {
  const i = Math.min(Math.max(1, Math.floor(attempts)), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[i]!;
}

export interface FailurePlan {
  status: 'error' | 'dead';
  attempts: number;
  /** null when dead */
  nextTryAt: number | null;
}

/**
 * Pure: what happens to a delivery that has just failed.
 * `final` (e.g. the user closed their DMs) gives up at once; `retryAfterMs` (Discord 429) stretches the delay.
 */
export function planFailure(previousAttempts: number, now: number, opts: { final?: boolean; retryAfterMs?: number } = {}): FailurePlan {
  const attempts = previousAttempts + 1;
  if (opts.final || attempts >= MAX_ATTEMPTS) return { status: 'dead', attempts, nextTryAt: null };
  const delay = Math.max(backoffMs(attempts), Math.min(Math.max(0, opts.retryAfterMs ?? 0), 3600_000));
  return { status: 'error', attempts, nextTryAt: now + delay };
}

export interface KindHooks {
  /** a delivery of this kind changed state (pending/sending/sent/error/dead) */
  onState?: (refId: number, status: DeliveryStatus, error: string | null, now: number) => void;
  /** the administrator asked for a manual retry; `payload` is what the ledger row stored */
  retry?: (refId: number, payload: Record<string, unknown>) => void;
}
const hooks = new Map<DeliveryKind, KindHooks>();
export function registerKind(kind: DeliveryKind, h: KindHooks): void {
  hooks.set(kind, h);
}

interface Row {
  id: number;
  kind: DeliveryKind;
  ref_id: number | null;
  target: string;
  payload: string;
  status: DeliveryStatus;
  attempts: number;
  next_try_at: number;
  last_error: string | null;
  created_at: number;
  sent_at: number | null;
}

function prune(now: number): void {
  db.prepare("DELETE FROM deliveries WHERE status = 'sent' AND created_at < ?").run(now - 7 * 86400_000);
  db.prepare("DELETE FROM deliveries WHERE created_at < ?").run(now - 30 * 86400_000);
}

/** Adds a delivery to the queue (alert, dm, status). */
export function enqueueDelivery(d: { kind: DeliveryKind; refId?: number | null; target: string; payload: unknown; delayMs?: number }): number {
  const now = Date.now();
  const r = db
    .prepare('INSERT INTO deliveries (kind, ref_id, target, payload, status, next_try_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(d.kind, d.refId ?? null, d.target, JSON.stringify(d.payload ?? {}), 'pending', now + (d.delayMs ?? 0), now);
  prune(now);
  return Number(r.lastInsertRowid);
}

/** Hands the due deliveries of the given kinds to the bot and marks them as being sent. */
export function claimDue(kinds: DeliveryKind[], now = Date.now(), limit = 25): { id: number; kind: DeliveryKind; refId: number | null; target: string; payload: unknown }[] {
  if (!kinds.length) return [];
  const ph = kinds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT * FROM deliveries WHERE kind IN (${ph})
         AND ((status IN ('pending','error') AND next_try_at <= ?) OR (status = 'sending' AND claimed_at < ?))
       ORDER BY id LIMIT ?`,
    )
    .all(...kinds, now, now - CLAIM_TIMEOUT_MS, limit) as Row[];
  const claim = db.prepare("UPDATE deliveries SET status = 'sending', claimed_at = ? WHERE id = ?");
  return rows.map((r) => {
    claim.run(now, r.id);
    if (r.ref_id !== null) hooks.get(r.kind)?.onState?.(r.ref_id, 'sending', r.last_error, now);
    return { id: r.id, kind: r.kind, refId: r.ref_id, target: r.target, payload: JSON.parse(r.payload) as unknown };
  });
}

/** The bot's verdict on a queued delivery. */
export function reportResult(id: number, res: { ok: true } | { ok: false; error: string; final?: boolean; retryAfterMs?: number }, now = Date.now()): boolean {
  const r = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id) as Row | undefined;
  if (!r) return false;
  let status: DeliveryStatus;
  let error: string | null = null;
  if (res.ok) {
    status = 'sent';
    db.prepare("UPDATE deliveries SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL, claimed_at = NULL WHERE id = ?").run(now, id);
  } else {
    const plan = planFailure(r.attempts, now, res);
    status = plan.status;
    error = res.error.slice(0, 300);
    db.prepare('UPDATE deliveries SET status = ?, attempts = ?, next_try_at = ?, last_error = ?, claimed_at = NULL WHERE id = ?').run(plan.status, plan.attempts, plan.nextTryAt ?? 0, error, id);
  }
  if (r.ref_id !== null) hooks.get(r.kind)?.onState?.(r.ref_id, status, error, now);
  return true;
}

/**
 * Ledger entry for a queue that lives elsewhere (news): one row per (kind, ref_id), updated on every attempt.
 */
export function ledgerRecord(e: {
  kind: DeliveryKind;
  refId: number;
  target: string;
  status: DeliveryStatus;
  attempts: number;
  error?: string | null;
  nextTryAt?: number | null;
  payload?: Record<string, unknown>;
  now?: number;
}): void {
  const now = e.now ?? Date.now();
  const open = db.prepare('SELECT id FROM deliveries WHERE kind = ? AND ref_id = ? ORDER BY id DESC LIMIT 1').get(e.kind, e.refId) as { id: number } | undefined;
  const sentAt = e.status === 'sent' ? now : null;
  if (open) {
    db.prepare('UPDATE deliveries SET status = ?, attempts = ?, next_try_at = ?, last_error = ?, sent_at = COALESCE(?, sent_at), payload = COALESCE(?, payload), target = ? WHERE id = ?').run(
      e.status,
      e.attempts,
      e.nextTryAt ?? 0,
      e.error ?? null,
      sentAt,
      e.payload ? JSON.stringify(e.payload) : null,
      e.target,
      open.id,
    );
  } else {
    db.prepare('INSERT INTO deliveries (kind, ref_id, target, payload, status, attempts, next_try_at, last_error, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      e.kind,
      e.refId,
      e.target,
      JSON.stringify(e.payload ?? {}),
      e.status,
      e.attempts,
      e.nextTryAt ?? 0,
      e.error ?? null,
      now,
      sentAt,
    );
    prune(now);
  }
}

function summary(r: Row): string {
  try {
    const p = JSON.parse(r.payload) as { summary?: string; content?: string; embed?: { title?: string } };
    return String(p.summary ?? p.embed?.title ?? p.content ?? '').slice(0, 120);
  } catch {
    return '';
  }
}

export function registerDeliveries(deps: { app: Express; admin: RequestHandler; internal: RequestHandler }): void {
  const { app, admin, internal } = deps;
  const KINDS = ['news', 'alert', 'dm', 'status'] as const;
  const STATUSES = ['pending', 'sending', 'sent', 'error', 'dead'] as const;

  app.get('/api/deliveries', admin, (req, res) => {
    const q = z
      .object({
        // an empty value means «no filter»: the panel used to send ?status=&kind=
        status: z.preprocess((v) => (v === '' ? undefined : v), z.enum(STATUSES).optional()),
        kind: z.preprocess((v) => (v === '' ? undefined : v), z.enum(KINDS).optional()),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Проверьте параметры фильтра' });
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.data.status) (where.push('status = ?'), args.push(q.data.status));
    if (q.data.kind) (where.push('kind = ?'), args.push(q.data.kind));
    const rows = db
      .prepare(`SELECT * FROM deliveries ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`)
      .all(...args, q.data.limit ?? 100) as Row[];
    const counts: Record<string, number> = { pending: 0, sending: 0, sent: 0, error: 0, dead: 0 };
    for (const c of db.prepare('SELECT status, COUNT(*) AS n FROM deliveries GROUP BY status').all() as { status: string; n: number }[]) counts[c.status] = c.n;
    res.json({
      counts,
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        refId: r.ref_id,
        target: r.target,
        status: r.status,
        attempts: r.attempts,
        nextTryAt: r.status === 'error' || r.status === 'pending' ? r.next_try_at || null : null,
        lastError: r.last_error,
        createdAt: r.created_at,
        sentAt: r.sent_at,
        summary: summary(r),
      })),
    });
  });

  app.post('/api/deliveries/:id/retry', admin, (req, res) => {
    const id = Number(req.params.id);
    const r = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id) as Row | undefined;
    if (!r) return res.status(404).json({ error: 'Доставка не найдена' });
    if (r.status !== 'dead' && r.status !== 'error') return res.status(409).json({ error: 'Повторить можно только неудавшуюся доставку' });
    const now = Date.now();
    db.prepare("UPDATE deliveries SET status = 'pending', attempts = 0, next_try_at = ?, last_error = NULL, claimed_at = NULL WHERE id = ?").run(now, id);
    if (r.ref_id !== null) {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(r.payload) as Record<string, unknown>;
      } catch {
        /* ledger payload is informational */
      }
      const h = hooks.get(r.kind);
      h?.retry?.(r.ref_id, payload);
      h?.onState?.(r.ref_id, 'pending', null, now);
    }
    res.json({ ok: true, id, status: 'pending' });
  });

  // ----- the bot -----
  app.get('/internal/deliveries/pending', internal, (req, res) => {
    const wanted = String(req.query.kinds ?? 'alert,dm,status')
      .split(',')
      .filter((k): k is 'alert' | 'dm' | 'status' => k === 'alert' || k === 'dm' || k === 'status');
    res.json(claimDue(wanted));
  });

  app.patch('/internal/deliveries/:id', internal, (req, res) => {
    const b = z
      .object({
        ok: z.boolean().optional(),
        status: z.enum(['sent', 'error']).optional(),
        error: z.string().max(300).nullable().optional(),
        final: z.boolean().optional(),
        retryAfterMs: z.number().int().min(0).max(3600_000).optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad body' });
    const ok = b.data.ok ?? b.data.status === 'sent';
    const done = reportResult(Number(req.params.id), ok ? { ok: true } : { ok: false, error: b.data.error ?? 'Ошибка отправки', final: b.data.final, retryAfterMs: b.data.retryAfterMs });
    if (!done) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });
}
