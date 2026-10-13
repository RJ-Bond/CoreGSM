/**
 * Secrets at rest.
 *
 * Sensitive settings (bot token, OAuth client secret, backup passphrase, proxy URL with its password, SMTP password ...)
 * are stored in the database as "enc:v1:<base64 iv(12) | tag(16) | ciphertext>" (AES-256-GCM).
 *
 * The key comes from SECRETS_KEY (>= 32 characters) or, when that is not set, is derived from JWT_SECRET (HKDF-SHA256).
 * Consequences worth knowing:
 *  - changing JWT_SECRET (or SECRETS_KEY) makes the stored secrets unreadable: the panel then treats them as "not set"
 *    and they have to be entered again;
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
]);

export const isSecretKey = (key: string): boolean => SECRET_SETTING_KEYS.has(key) || /_(secret|token)$/.test(key);

export class SecretError extends Error {}

let cached: { src: string; key: Buffer } | null = null;

function masterKey(): Buffer {
  const own = (process.env.SECRETS_KEY ?? '').trim();
  const src = own.length >= 32 ? own : (process.env.JWT_SECRET ?? '');
  if (src.length < 32) throw new SecretError('нет ключа шифрования: задайте SECRETS_KEY или JWT_SECRET (не короче 32 символов)');
  if (cached && cached.src === src) return cached.key;
  const key = Buffer.from(crypto.hkdfSync('sha256', src, 'coregsm-secrets-v1', 'settings-aes-256-gcm', 32));
  cached = { src, key };
  return key;
}

export const isEncrypted = (v: string): boolean => v.startsWith(ENC_PREFIX);

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ENC_PREFIX + Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

/** A value without the prefix is a legacy plaintext and is returned as is. Throws SecretError when it cannot be decrypted. */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  try {
    const raw = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
    if (raw.length < 29) throw new Error('short');
    const d = crypto.createDecipheriv('aes-256-gcm', masterKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch (e) {
    if (e instanceof SecretError) throw e;
    throw new SecretError('значение зашифровано другим ключом (SECRETS_KEY / JWT_SECRET) и не может быть прочитано');
  }
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
