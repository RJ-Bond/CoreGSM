/** The panel as a site: public address, access settings, branding. */
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import { db, getSetting, setSetting } from './db.js';

export const needsSetup = () => !db.prepare('SELECT 1 FROM users LIMIT 1').get();

// ---------- access: who may look at the panel, who may register ----------
// The public https address of the panel (Discord needs it to load embed images). Trusted sources only, in this order:
// PUBLIC_URL, https://DOMAIN, and the address an administrator opened the panel at (saved from an authenticated request).
// A guest's Host header is never stored: it would let anyone point the embeds at their own server.
export const isRealDomain = (d: string) => /^[a-z0-9.-]+$/i.test(d) && d.includes('.') && !/^[\d.]+$/.test(d) && d.toLowerCase() !== 'localhost';
export function publicBase(): string | null {
  const env = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^\s/]+$/i.test(env)) return env;
  const d = (process.env.DOMAIN ?? '').trim();
  if (isRealDomain(d)) return `https://${d}`;
  return getSetting('public_base') || null;
}
/** called only for requests that carry a valid administrator token */
export function rememberAdminBase(req: Request) {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim().split(':')[0];
  if (!isRealDomain(host)) return;
  const base = `https://${host}`;
  if (getSetting('public_base') !== base) setSetting('public_base', base);
}

export const registrationMode = (): 'open' | 'approval' => (getSetting('registration_mode') === 'approval' ? 'approval' : 'open');
export const rulesText = () => getSetting('rules_text') ?? '';

// ---------- branding: community name, accent colour and logo ----------
export const LOGO_PATH = path.join(path.dirname(process.env.DB_PATH ?? './data/coregsm.db'), 'brand-logo');
export const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export const logoFile = () => Object.values(LOGO_TYPES).map((e) => `${LOGO_PATH}.${e}`).find((f) => fs.existsSync(f)) ?? null;
export const brand = () => ({
  name: getSetting('brand_name') || 'CoreGSM',
  color: getSetting('brand_color') || '#4f46e5',
  color2: getSetting('brand_color2') || '',
  preset: getSetting('brand_preset') || '',
  hasLogo: !!logoFile(),
  logoV: logoFile() ? Math.floor(fs.statSync(logoFile()!).mtimeMs) : 0,
});

export const baseOf = (req: Request) => `${req.protocol}://${req.get('host')}`;
