/**
 * Two-factor sign-in: TOTP (RFC 6238, SHA-1, 6 digits, 30 s: what Google Authenticator, Aegis, 1Password and the others
 * speak) and one-time recovery codes. No dependency: it is HMAC and base32.
 */
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SEC = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newSecret = (): string => base32Encode(crypto.randomBytes(20));

/** the 6-digit code of one 30-second step */
export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Checks a code against the current step and one step either side (clock drift). Returns the matched step so the caller
 * can refuse to accept it a second time (replay), or null.
 */
export function verifyCode(secret: string, code: string, now = Date.now(), lastStep = 0): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = Math.floor(now / 1000 / STEP_SEC);
  for (const step of [cur, cur - 1, cur + 1]) {
    if (step <= lastStep) continue;
    const want = Buffer.from(codeAt(secret, step));
    if (crypto.timingSafeEqual(want, Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SEC}`;
}

const hashCode = (c: string): string => crypto.createHash('sha256').update(c.replace(/[\s-]/g, '').toLowerCase()).digest('hex');

/** 8 one-time codes: the plain list (shown once) and the hashes to store */
export function newRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: 8 }, () => {
    const raw = crypto.randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { plain, hashes: plain.map(hashCode) };
}

/** removes the code from the list when it matches; null when it does not */
export function useRecoveryCode(hashes: string[], code: string): string[] | null {
  if (!/^[0-9a-f]{5}-?[0-9a-f]{5}$/i.test(code.trim())) return null;
  const h = hashCode(code);
  const i = hashes.indexOf(h);
  if (i < 0) return null;
  return hashes.filter((_, j) => j !== i);
}
