/** Settings from the environment, checked at start: the process stops when a required secret is missing. */
import crypto from 'node:crypto';
import { log } from './logger.js';

export const PORT = Number(process.env.PORT ?? 3000);
export const JWT_SECRET = process.env.JWT_SECRET ?? '';
export const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? '';
export const POLL_MS = Number(process.env.POLL_INTERVAL_SEC ?? 30) * 1000;
// one-time code that protects the first-run setup wizard from strangers who find the panel first
export const SETUP_TOKEN = process.env.SETUP_TOKEN || crypto.randomBytes(8).toString('hex');

if (JWT_SECRET.length < 32) {
  log.error('JWT_SECRET must be set and at least 32 characters long (generate one with: openssl rand -hex 32)');
  process.exit(1);
}
if (INTERNAL_TOKEN.length < 16) {
  log.error('INTERNAL_TOKEN must be set (min 16 chars)');
  process.exit(1);
}
export const APP_VERSION = process.env.APP_VERSION ?? '';
/** the readable version of the running build («1.0.0.7»); empty on installs made before versions had names */
export const APP_VERSION_NAME = process.env.APP_VERSION_NAME ?? '';
