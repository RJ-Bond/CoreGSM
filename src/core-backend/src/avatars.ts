/**
 * User avatars uploaded in the profile. The picture is cropped to a square and stored as a 256 px PNG
 * (<data dir>/avatars/<user id>.png); it takes priority over the Discord avatar.
 */
import express, { type Express, type RequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import skia from 'skia-canvas';

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

/** the picture of a user: the uploaded one first, then the linked Discord account's, otherwise null */
export function avatarFor(u: { id: number; discord_id: string | null; discord_avatar: string | null }): string | null {
  return customAvatarUrl(u.id) ?? (u.discord_id && u.discord_avatar ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.discord_avatar}.png?size=64` : null);
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

  app.get('/api/avatars/:file', (req, res) => {
    const m = /^(\d{1,9})\.png$/.exec(String(req.params.file));
    if (!m) return res.status(404).end();
    const f = fileOf(Number(m[1]));
    if (!fs.existsSync(f)) return res.status(404).end();
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(fs.readFileSync(f));
  });
}
