/** Settings from the environment, checked at start: the process stops when a required secret is missing. */
import crypto from 'node:crypto';

export const PORT = Number(process.env.PORT ?? 3000);
export const JWT_SECRET = process.env.JWT_SECRET ?? '';
export const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? '';
export const POLL_MS = Number(process.env.POLL_INTERVAL_SEC ?? 30) * 1000;
// one-time code that protects the first-run setup wizard from strangers who find the panel first
export const SETUP_TOKEN = process.env.SETUP_TOKEN || crypto.randomBytes(8).toString('hex');

if (JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set and at least 32 characters long (generate one with: openssl rand -hex 32)');
  process.exit(1);
}
if (INTERNAL_TOKEN.length < 16) {
  console.error('INTERNAL_TOKEN must be set (min 16 chars)');
  process.exit(1);
}
export const APP_VERSION = process.env.APP_VERSION ?? '';
