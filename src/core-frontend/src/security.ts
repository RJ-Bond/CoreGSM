import { t, type TKey } from './i18n';

/** Helpers of the account-security extras: the "sign-in from a new device" banner and secrets a restore could not read. */

const NEWDEV_PREFIX = 'coregsm_newdev_';

/** localStorage key that remembers "this sign-in was me" for one sign-in time */
export const newDeviceKey = (ts: number) => `${NEWDEV_PREFIX}${Math.floor(Number(ts) || 0)}`;

export function isNewDeviceDismissed(ts: number): boolean {
  try { return localStorage.getItem(newDeviceKey(ts)) === '1'; } catch { return false; }
}

export function dismissNewDevice(ts: number): void {
  try { localStorage.setItem(newDeviceKey(ts), '1'); } catch { /* storage blocked: the banner just comes back */ }
}

/** settings that a restored archive could not decrypt (the secrets key differs); the label is translated */
export const SECRET_KEYS: Record<string, TKey> = {
  discord_token: 'secret.discord_token',
  discord_client_secret: 'secret.discord_client_secret',
  backup_passphrase: 'secret.backup_passphrase',
  proxy_url: 'secret.proxy_url',
  smtp_password: 'secret.smtp_password',
  backup_remote_url: 'secret.backup_remote_url',
};

export function unreadableSecrets(raw: unknown): { id: string; label: string }[] {
  const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
  return [...new Set(list)].map((id) => ({ id, label: SECRET_KEYS[id] ? t(SECRET_KEYS[id]) : id }));
}

const UNREADABLE_KEY = 'coregsm_unreadable_secrets';

/** the list is kept for the tab session so the warning survives the reload after a restore */
export function saveUnreadableSecrets(ids: string[]): void {
  try {
    if (ids.length) sessionStorage.setItem(UNREADABLE_KEY, JSON.stringify(ids));
    else sessionStorage.removeItem(UNREADABLE_KEY);
  } catch { /* ignore */ }
}

export function loadUnreadableSecrets(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(UNREADABLE_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
