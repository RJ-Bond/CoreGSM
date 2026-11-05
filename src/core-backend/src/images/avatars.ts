/**
 * User avatars uploaded in the profile. The picture is cropped to a square and stored as a 256 px PNG
 * (<data dir>/avatars/<user id>.png); it takes priority over the Discord avatar.
 */
import { imageProblem } from './imageGuard.js';
import { sendImage } from './imageSend.js';
import express, { type Express, type RequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import skia from 'skia-canvas';
import { discordFetch } from '../security/proxyFetch.js';
import { log } from '../logger.js';

const { Canvas, loadImage } = skia;

const DIR = path.join(path.dirname(process.env.DB_PATH ?? './data/coregsm.db'), 'avatars');
fs.mkdirSync(DIR, { recursive: true });

const fileOf = (userId: number) => path.join(DIR, `${Math.trunc(userId)}.png`);

/** "/api/avatars/7.png?v=<mtime>" when the user uploaded a picture, otherwise null */
export function customAvatarUrl(userId: number): string | null {
  try {
    const st = fs.statSync(fileOf(userId));
    return `/api/avatars/${Math.trunc(userId)}.png?v=${Math.floor(st.mtimeMs)}`;
  } catch {
    return null;
  }
}

const HASH = /^[a-z0-9_]{1,64}$/i;
const mirrorFile = (userId: number, hash: string) => path.join(DIR, `d${Math.trunc(userId)}_${hash}.png`);
const inFlight = new Set<string>();

/**
 * Copies the Discord picture of a user to our own storage, so that browsers that cannot reach Discord's CDN (it is blocked in
 * some countries) still see it. The request goes through the same proxy as the bot. True when the copy exists afterwards.
 */
export async function mirrorDiscordAvatar(userId: number, discordId: string, hash: string): Promise<boolean> {
  if (!HASH.test(hash) || !/^\d{15,25}$/.test(discordId)) return false;
  const f = mirrorFile(userId, hash);
  if (fs.existsSync(f)) return true;
  const key = `${userId}:${hash}`;
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  try {
    const r = await discordFetch(`https://cdn.discordapp.com/avatars/${discordId}/${hash}.png?size=256`, { timeoutMs: 15_000 });
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 100 || buf.length > 2 * 1024 * 1024 || imageProblem(buf)) return false;
    fs.writeFileSync(f, buf, { mode: 0o644 });
    // older copies of the same user are not needed any more
    for (const n of fs.readdirSync(DIR)) if (n.startsWith(`d${Math.trunc(userId)}_`) && n !== path.basename(f)) fs.rmSync(path.join(DIR, n), { force: true });
    return true;
  } catch (e) {
    log.warn('Discord avatar copy failed', (e as Error).message);
    return false;
  } finally {
    inFlight.delete(key);
  }
}

/** the Discord picture of the user: our copy when there is one (and a copy is started when there is not), otherwise Discord's own address */
export function discordAvatarUrl(userId: number, discordId: string | null, hash: string | null): string | null {
  if (!discordId || !hash || !HASH.test(hash)) return null;
  if (fs.existsSync(mirrorFile(userId, hash))) return `/api/avatars/d${Math.trunc(userId)}_${hash}.png`;
  void mirrorDiscordAvatar(userId, discordId, hash);
  return `https://cdn.discordapp.com/avatars/${discordId}/${hash}.png?size=64`;
}

/** the picture of a user: the uploaded one first, then the linked Discord account's, otherwise null */
export function avatarFor(u: { id: number; discord_id: string | null; discord_avatar: string | null }): string | null {
  return customAvatarUrl(u.id) ?? discordAvatarUrl(u.id, u.discord_id, u.discord_avatar);
}

export function removeAvatar(userId: number): void {
  fs.rmSync(fileOf(userId), { force: true });
}

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function registerAvatars(deps: { app: Express; auth: RequestHandler; userId: (req: express.Request) => number;
  /** called after the picture was set or removed (account journal) */
  onChange?: (req: express.Request, userId: number, what: string) => void;
}): void {
  const { app, auth, userId, onChange } = deps;

  app.put('/api/me/avatar', auth, express.raw({ type: TYPES, limit: '3mb' }), async (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'Нужна картинка PNG, JPG или WebP до 3 МБ' });
    try {
      if (imageProblem(body)) throw new Error('size');
      const img = await loadImage(body);
      if (!img.width || !img.height || img.width > 8000 || img.height > 8000) throw new Error('size');
      const side = Math.min(img.width, img.height);
      const canvas = new Canvas(256, 256);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      // centre crop to a square
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
      const png = await canvas.toBuffer('png');
      fs.writeFileSync(fileOf(userId(req)), png, { mode: 0o644 });
      onChange?.(req, userId(req), 'загружен');
      res.json({ avatarUrl: customAvatarUrl(userId(req)) });
    } catch {
      res.status(400).json({ error: 'Не удалось прочитать картинку: выберите PNG, JPG или WebP' });
    }
  });

  app.delete('/api/me/avatar', auth, (req, res) => {
    removeAvatar(userId(req));
    onChange?.(req, userId(req), 'убран');
    res.json({ ok: true });
  });

  app.get('/api/avatars/:file', (req, res, next) => {
    const file = String(req.params.file);
    const m = /^(\d{1,9})\.png$/.exec(file);
    const d = /^d(\d{1,9})_([a-z0-9_]{1,64})\.png$/i.exec(file);
    if (!m && !d) return res.status(404).end();
    const f = m ? fileOf(Number(m[1])) : mirrorFile(Number(d![1]), d![2]!);
    if (!fs.existsSync(f)) return res.status(404).end();
    // a copy of a Discord picture never changes (the hash is in the name), the uploaded one can
    sendImage(req, res, f, 'image/png', d ? 'public, max-age=31536000, immutable' : 'public, max-age=86400').catch(next);
  });
}
