/**
 * A captcha with no outside service: a small proof of work. After a few wrong passwords from one address the panel asks
 * the browser to find a number that makes SHA-256(challenge:nonce) start with N zero bits (a fraction of a second for a
 * person, a real cost for a script that tries thousands of passwords). Nothing is loaded from another site, so the
 * content security policy stays as strict as it was.
 *
 *   GET /api/auth/challenge   { challenge, bits }  (a challenge lives 2 minutes and works once)
 *
 * The challenge is signed with the server secret, so it needs no storage until it is used.
 */
import crypto from 'node:crypto';
import { JWT_SECRET } from '../config.js';
import { guardDelete, guardGet, guardSet } from './loginGuard.js';

export const POW_BITS = 16;
/** wrong passwords from one address before the puzzle is asked (LOGIN_CAPTCHA_AFTER; 0 turns it off) */
const fromEnv = Number(process.env.LOGIN_CAPTCHA_AFTER ?? 3);
export const POW_AFTER = Number.isFinite(fromEnv) && fromEnv >= 0 ? Math.trunc(fromEnv) : 3;
const TTL_MS = 2 * 60_000;

const sign = (body: string) => crypto.createHmac('sha256', `pow:${JWT_SECRET}`).update(body).digest('base64url');

export function newChallenge(now = Date.now()): { challenge: string; bits: number } {
  const body = `${now + TTL_MS}.${crypto.randomBytes(12).toString('base64url')}`;
  return { challenge: `${body}.${sign(body)}`, bits: POW_BITS };
}

export function leadingZeroBits(buf: Buffer): number {
  let n = 0;
  for (const b of buf) {
    if (b === 0) { n += 8; continue; }
    n += Math.clz32(b) - 24;
    break;
  }
  return n;
}

/** true when the challenge is ours, fresh, not used before, and the nonce solves it; a good challenge is spent */
export function checkProof(challenge: unknown, nonce: unknown, now = Date.now()): boolean {
  if (typeof challenge !== 'string' || typeof nonce !== 'string' || challenge.length > 120 || nonce.length > 24) return false;
  const parts = challenge.split('.');
  if (parts.length !== 3) return false;
  const body = `${parts[0]}.${parts[1]}`;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(parts[2]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return false;
  const exp = Number(parts[0]);
  if (!Number.isFinite(exp) || exp < now) return false;
  if (leadingZeroBits(crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest()) < POW_BITS) return false;
  // one use: remembered until the challenge would have expired anyway
  if (guardGet('pow', parts[1])) return false;
  guardSet('pow', parts[1], 1, exp + 1000);
  return true;
}

// ---------- when the captcha is asked: after POW_AFTER wrong passwords from the address within half an hour ----------
interface Fails { n: number }
export const captchaNeeded = (ip: string | undefined): boolean => POW_AFTER > 0 && (guardGet<Fails>('powfail', ip ?? 'x')?.n ?? 0) >= POW_AFTER;
export function captchaFailure(ip: string | undefined): void {
  const key = ip ?? 'x';
  const f = guardGet<Fails>('powfail', key) ?? { n: 0 };
  f.n++;
  guardSet('powfail', key, f, Date.now() + 30 * 60_000);
}
export const captchaClear = (ip: string | undefined): void => guardDelete('powfail', ip ?? 'x');
