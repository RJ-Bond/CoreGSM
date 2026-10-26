/**
 * Secrets at rest.
 *
 * Sensitive settings (bot token, OAuth client secret, backup passphrase, proxy URL with its password, SMTP password ...)
 * are stored in the database as "enc:v1:<base64 iv(12) | tag(16) | ciphertext>" (AES-256-GCM).
 *
 * The key comes from SECRETS_KEY (>= 32 characters), which the installer generates on its own. Older installations
 * have no SECRETS_KEY and their key is derived from JWT_SECRET (HKDF-SHA256). While SECRETS_KEY is set, values that
 * were encrypted with the JWT_SECRET-derived key are still readable (the "legacy" key) and are re-encrypted with the
 * new key at start (see reencryptLegacy), so JWT_SECRET can be changed afterwards (to end every session) without
 * losing the stored secrets.
 * Consequences worth knowing:
 *  - changing SECRETS_KEY makes the stored secrets unreadable: the panel then treats them as "not set" and they have
 *    to be entered again; without SECRETS_KEY the same is true for JWT_SECRET;
 *  - a backup restored onto a host with a different key has the same problem: restore with the same SECRETS_KEY
 *    (or JWT_SECRET) as the host that created the backup. The restore reports such values instead of failing.
 */
import crypto from 'node:crypto';

export const ENC_PREFIX = 'enc:v1:';

/** settings that are always stored encrypted (besides every key ending in _secret or _token) */
export const SECRET_SETTING_KEYS: ReadonlySet<string> = new Set([
  'discord_token',
  'discord_client_secret',
  'backup_passphrase',
  'proxy_url',
  'smtp_password',
  // may carry credentials (https://user:pass@host/...)
  'backup_remote_url',
  // the S3 access key (the secret key ends in _secret and is covered by the pattern)
  'backup_s3_key',
]);

export const isSecretKey = (key: string): boolean => SECRET_SETTING_KEYS.has(key) || /_(secret|token)$/.test(key);

export class SecretError extends Error {}

const keyCache = new Map<string, Buffer>();
function keyFrom(src: string): Buffer {
  let k = keyCache.get(src);
  if (!k) {
    k = Buffer.from(crypto.hkdfSync('sha256', src, 'coregsm-secrets-v1', 'settings-aes-256-gcm', 32));
    keyCache.set(src, k);
  }
  return k;
}

/** The key that new secrets are written with, and the JWT_SECRET-derived one that old values may still use. */
function keys(): { primary: Buffer; legacy: Buffer | null } {
  const own = (process.env.SECRETS_KEY ?? '').trim();
  const jwt = process.env.JWT_SECRET ?? '';
  const primarySrc = own.length >= 32 ? own : jwt;
  if (primarySrc.length < 32) throw new SecretError('нет ключа шифрования: задайте SECRETS_KEY или JWT_SECRET (не короче 32 символов)');
  const legacy = primarySrc !== jwt && jwt.length >= 32 ? keyFrom(jwt) : null;
  return { primary: keyFrom(primarySrc), legacy };
}

export const isEncrypted = (v: string): boolean => v.startsWith(ENC_PREFIX);

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keys().primary, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ENC_PREFIX + Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

function open(raw: Buffer, key: Buffer): string {
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

function decryptWith(stored: string): { plain: string; legacy: boolean } {
  const { primary, legacy } = keys();
  const raw = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
  if (raw.length >= 29) {
    try {
      return { plain: open(raw, primary), legacy: false };
    } catch {
      /* not the current key: try the one derived from JWT_SECRET */
    }
    if (legacy) {
      try {
        return { plain: open(raw, legacy), legacy: true };
      } catch {
        /* neither key fits */
      }
    }
  }
  throw new SecretError('значение зашифровано другим ключом (SECRETS_KEY / JWT_SECRET) и не может быть прочитано');
}

/** A value without the prefix is a legacy plaintext and is returned as is. Throws SecretError when it cannot be decrypted. */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  return decryptWith(stored).plain;
}

/** true when the stored value can be read with the current key (plaintext always can) */
export function canDecrypt(stored: string): boolean {
  try {
    decryptSecret(stored);
    return true;
  } catch {
    return false;
  }
}

/** true when the value is readable only with the old JWT_SECRET-derived key, so it should be written again */
export function usesLegacyKey(stored: string): boolean {
  if (!isEncrypted(stored)) return false;
  try {
    return decryptWith(stored).legacy;
  } catch {
    return false;
  }
}

/** The same secret, encrypted with the current key (for values where usesLegacyKey() is true). */
export const reencrypt = (stored: string): string => encryptSecret(decryptSecret(stored));
