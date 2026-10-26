/**
 * API keys: generation, hashing, reading a key from a request and the per-key sliding-window limiter.
 * Pure functions (no database, no Express) so they are easy to test; apiKeys.ts stores and checks the keys.
 */
import crypto from 'node:crypto';

export const KEY_PREFIX = 'cgsm_';
/** how many characters of a key are kept in the clear, to recognise it in the list */
export const SHOWN_PREFIX_LEN = 10;
export const DEFAULT_RATE_LIMIT = 60;
export const MIN_RATE_LIMIT = 1;
export const MAX_RATE_LIMIT = 6000;

/** a new key: `cgsm_` + 32 random bytes in base64url */
export const generateKey = (): string => KEY_PREFIX + crypto.randomBytes(32).toString('base64url');

/** the SHA-256 of a key in hex: the only thing the database keeps */
export const hashKey = (key: string): string => crypto.createHash('sha256').update(key, 'utf8').digest('hex');

/** the start of a key shown in the list (never enough to use it) */
export const keyPrefix = (key: string): string => key.slice(0, SHOWN_PREFIX_LEN);

/** does the text look like one of our keys (cheap check before touching the database) */
export const looksLikeKey = (s: string): boolean => /^cgsm_[A-Za-z0-9_-]{43}$/.test(s);

/** the key of a request: `Authorization: Bearer <key>` or `X-API-Key: <key>`; '' when there is none */
export function extractKey(headers: Record<string, string | string[] | undefined>): string {
  const auth = headers.authorization;
  const a = Array.isArray(auth) ? auth[0] : auth;
  if (a) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(a);
    if (m) return m[1];
  }
  const x = headers['x-api-key'];
  const v = Array.isArray(x) ? x[0] : x;
  return v ? v.trim() : '';
}

export const clampRateLimit = (n: number): number => Math.min(MAX_RATE_LIMIT, Math.max(MIN_RATE_LIMIT, Math.round(n)));

export interface LimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** seconds until the next request is allowed (0 when ok) */
  retryAfter: number;
}

/** sliding window of `windowMs`: at most `limit` requests inside any window; the timestamps are kept per key */
export class SlidingWindow {
  private hits = new Map<string, number[]>();
  constructor(private windowMs = 60_000) {}

  hit(key: string, limit: number, now = Date.now()): LimitResult {
    const arr = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      return { ok: false, limit, remaining: 0, retryAfter: Math.max(1, Math.ceil((arr[0] + this.windowMs - now) / 1000)) };
    }
    arr.push(now);
    this.hits.set(key, arr);
    return { ok: true, limit, remaining: limit - arr.length, retryAfter: 0 };
  }

  /** forgets keys that have been quiet for a whole window */
  prune(now = Date.now()): void {
    for (const [k, arr] of this.hits) if (!arr.length || arr[arr.length - 1] <= now - this.windowMs) this.hits.delete(k);
  }

  get size(): number {
    return this.hits.size;
  }
}
