/**
 * API keys for the public API (publicApi.ts). Only the SHA-256 of a key is stored; the key itself is shown once, in
 * the answer that creates it.
 *
 *   GET    /api/integrations/keys       the keys (name, start of the key, dates, limit, revoked or not)      administrator
 *   POST   /api/integrations/keys       { name, rateLimit? } -> the new key, shown this once                  administrator
 *   DELETE /api/integrations/keys/:id   revoke a key (it stops working at once)                               administrator
 */
import { stepUp } from './stepUp.js';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { param, safeEqual } from '../http.js';
import { clampRateLimit, DEFAULT_RATE_LIMIT, extractKey, generateKey, hashKey, ipAllowed, keyExpired, keyPrefix, looksLikeKey, normalizeIp, parseAllowList, SlidingWindow } from './apiKeyLogic.js';

export const MAX_ACTIVE_KEYS = 20;

interface KeyRow {
  id: number;
  name: string;
  prefix: string;
  key_hash: string;
  created_at: number;
  created_by: string;
  last_used_at: number | null;
  revoked_at: number | null;
  rate_limit: number;
  expires_at: number | null;
  /** the addresses and networks the key may be used from, one per line; '' = any */
  allow_ips: string;
  last_used_ip: string;
}

const view = (r: KeyRow) => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  createdAt: r.created_at,
  createdBy: r.created_by,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
  rateLimit: r.rate_limit,
  expiresAt: r.expires_at,
  allowIps: r.allow_ips ? r.allow_ips.split('\n') : [],
  lastUsedIp: r.last_used_ip || null,
});

/** creates a key; returns the plain key (the only moment it exists) and the stored row */
export function createApiKey(name: string, createdBy: string, rateLimit = DEFAULT_RATE_LIMIT, now = Date.now(), opts: { expiresAt?: number | null; allowIps?: string[] } = {}) {
  const key = generateKey();
  const info = db
    .prepare('INSERT INTO api_keys (name, prefix, key_hash, created_at, created_by, rate_limit, expires_at, allow_ips) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, keyPrefix(key), hashKey(key), now, createdBy, clampRateLimit(rateLimit), opts.expiresAt ?? null, (opts.allowIps ?? []).join('\n'));
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(Number(info.lastInsertRowid)) as KeyRow;
  return { key, row };
}

/** the live (not revoked) key with this plain value, or null; the hash is compared in constant time */
export function findActiveKey(plain: string): KeyRow | null {
  if (!looksLikeKey(plain)) return null;
  const h = hashKey(plain);
  const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(h) as KeyRow | undefined;
  if (!row || row.revoked_at !== null || !safeEqual(row.key_hash, h)) return null;
  // a key that is out of date stops working like a revoked one
  if (keyExpired(row.expires_at)) return null;
  return row;
}

export interface ApiKeyInfo {
  id: number;
  name: string;
  rateLimit: number;
}
export type KeyedRequest = Request & { apiKey?: ApiKeyInfo };

const windows = new SlidingWindow(60_000);
setInterval(() => windows.prune(), 60_000).unref();
/** a wrong key is slowed down per address, so keys cannot be guessed by trying */
const failWindows = new SlidingWindow(60_000);
setInterval(() => failWindows.prune(), 60_000).unref();
const FAIL_LIMIT = 30;
const lastTouch = new Map<number, number>();

/** the error body of the public API: the same shape everywhere */
export const apiError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ error: { code, message } });
};

/** `Authorization: Bearer <key>` or `X-API-Key`; checks the key and the limit of the key (429 with Retry-After) */
export const apiKeyAuth: RequestHandler = (req: KeyedRequest, res: Response, next: NextFunction) => {
  const ip = req.ip ?? 'x';
  const plain = extractKey(req.headers);
  if (!plain) return void apiError(res, 401, 'unauthorized', 'An API key is required: send it as "Authorization: Bearer <key>" or in X-API-Key.');
  const row = findActiveKey(plain);
  if (!row) {
    const f = failWindows.hit(ip, FAIL_LIMIT);
    if (!f.ok) {
      res.setHeader('Retry-After', String(f.retryAfter));
      return void apiError(res, 429, 'rate_limited', 'Too many requests with a wrong key. Try again later.');
    }
    return void apiError(res, 401, 'invalid_key', 'The API key is wrong or has been revoked.');
  }
  // a key tied to addresses works from them only; the answer does not say which addresses (nothing to learn from a guess)
  if (row.allow_ips && !ipAllowed(ip, row.allow_ips.split('\n'))) {
    failWindows.hit(ip, FAIL_LIMIT);
    return void apiError(res, 403, 'forbidden_ip', 'This API key cannot be used from this address.');
  }
  const r = windows.hit(`k${row.id}`, row.rate_limit);
  res.setHeader('X-RateLimit-Limit', String(r.limit));
  res.setHeader('X-RateLimit-Remaining', String(r.remaining));
  if (!r.ok) {
    res.setHeader('Retry-After', String(r.retryAfter));
    return void apiError(res, 429, 'rate_limited', `Rate limit of ${row.rate_limit} requests per minute exceeded.`);
  }
  // "last used" is written at most once a minute per key
  const now = Date.now();
  if (now - (lastTouch.get(row.id) ?? 0) >= 60_000) {
    lastTouch.set(row.id, now);
    try {
      db.prepare('UPDATE api_keys SET last_used_at = ?, last_used_ip = ? WHERE id = ?').run(now, normalizeIp(ip).slice(0, 64), row.id);
    } catch {
      /* a bookkeeping failure must not fail the request */
    }
  }
  req.apiKey = { id: row.id, name: row.name, rateLimit: row.rate_limit };
  next();
};

export function registerApiKeys({ app, admin }: { app: Express; admin: RequestHandler }): void {
  app.get('/api/integrations/keys', admin, (_req, res) => {
    res.json((db.prepare('SELECT * FROM api_keys ORDER BY id DESC').all() as KeyRow[]).map(view));
  });

  app.post('/api/integrations/keys', admin, stepUp, (req, res) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(60),
        rateLimit: z.number().int().min(1).max(6000).optional(),
        /** days until the key stops working; absent = never */
        expiresInDays: z.number().int().min(1).max(3650).optional(),
        /** addresses and IPv4 networks, one per line; absent or empty = any address */
        allowIps: z.string().max(1000).optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
    const allow = parseAllowList(b.data.allowIps ?? '');
    if (allow === null) return res.status(400).json({ error: 'Список адресов: до 20 записей, каждая — адрес или сеть вида 203.0.113.0/24' });
    const active = (db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE revoked_at IS NULL').get() as { n: number }).n;
    if (active >= MAX_ACTIVE_KEYS) return res.status(400).json({ error: `Можно держать не больше ${MAX_ACTIVE_KEYS} действующих ключей: отзовите ненужные` });
    const actor = (req as Request & { user?: { username: string } }).user?.username ?? '';
    const { key, row } = createApiKey(b.data.name, actor, b.data.rateLimit ?? DEFAULT_RATE_LIMIT, Date.now(), {
      expiresAt: b.data.expiresInDays ? Date.now() + b.data.expiresInDays * 86_400_000 : null,
      allowIps: allow,
    });
    res.status(201).json({ ...view(row), key });
  });

  app.delete('/api/integrations/keys/:id', admin, param('id'), (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as KeyRow | undefined;
    if (!row) return res.status(404).json({ error: 'Не найдено' });
    if (row.revoked_at === null) db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(Date.now(), id);
    res.json(view(db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as KeyRow));
  });
}
