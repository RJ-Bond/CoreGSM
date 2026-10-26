/**
 * Cover pictures of servers. The uploaded picture is centre-cropped to 16:9 and stored as a 1280x720 JPEG
 * (<data dir>/covers/<server id>.jpg) plus a 640x360 variant (<server id>@s.jpg) for small tiles.
 */
import { sendImage } from './imageSend.js';
import express, { type Express, type RequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import skia from 'skia-canvas';
import { db } from './db.js';

const { Canvas, loadImage } = skia;

const DIR = path.join(path.dirname(process.env.DB_PATH ?? './data/coregsm.db'), 'covers');
fs.mkdirSync(DIR, { recursive: true });

const id9 = (id: number) => Math.trunc(id);
const fileOf = (id: number, small = false) => path.join(DIR, `${id9(id)}${small ? '@s' : ''}.jpg`);

/** "/api/covers/7.jpg?v=<mtime>" when the server has a cover, otherwise null */
export function coverUrl(serverId: number): string | null {
  try {
    const st = fs.statSync(fileOf(serverId));
    return `/api/covers/${id9(serverId)}.jpg?v=${Math.floor(st.mtimeMs)}`;
  } catch {
    return null;
  }
}

/** the path of the server's cover file (the 640px one when `small`), or null without a cover */
export function coverFile(serverId: number, small = false): string | null {
  const f = fileOf(serverId, small);
  return fs.existsSync(f) ? f : null;
}

export function removeCover(serverId: number): void {
  fs.rmSync(fileOf(serverId), { force: true });
  fs.rmSync(fileOf(serverId, true), { force: true });
}

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

async function render(img: Awaited<ReturnType<typeof loadImage>>, w: number, h: number): Promise<Buffer> {
  // centre crop to 16:9
  let sw = img.width;
  let sh = (img.width * 9) / 16;
  if (sh > img.height) {
    sh = img.height;
    sw = (img.height * 16) / 9;
  }
  const canvas = new Canvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
  return canvas.toBuffer('jpeg', { quality: 0.82 });
}

export function registerCovers(deps: { app: Express; admin: RequestHandler }): void {
  const { app, admin } = deps;

  app.put('/api/servers/:id/cover', admin, express.raw({ type: TYPES, limit: '5mb' }), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM servers WHERE id = ?').get(id)) return res.status(404).json({ error: 'Сервер не найден' });
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'Нужна картинка PNG, JPG или WebP до 5 МБ' });
    try {
      const img = await loadImage(body);
      if (!img.width || !img.height || img.width > 10000 || img.height > 10000) throw new Error('size');
      const big = await render(img, 1280, 720);
      const small = await render(img, 640, 360);
      fs.writeFileSync(fileOf(id), big, { mode: 0o644 });
      fs.writeFileSync(fileOf(id, true), small, { mode: 0o644 });
      res.json({ coverUrl: coverUrl(id) });
    } catch {
      res.status(400).json({ error: 'Не удалось прочитать картинку: выберите PNG, JPG или WebP' });
    }
  });

  app.delete('/api/servers/:id/cover', admin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Сервер не найден' });
    removeCover(id);
    res.json({ ok: true, coverUrl: null });
  });

  app.get('/api/covers/:file', (req, res, next) => {
    const m = /^(\d{1,9})\.jpg$/.exec(String(req.params.file));
    if (!m) return res.status(404).end();
    let f = fileOf(Number(m[1]), req.query.s === '1');
    if (!fs.existsSync(f)) f = fileOf(Number(m[1]));
    if (!fs.existsSync(f)) return res.status(404).end();
    sendImage(req, res, f, 'image/jpeg', 'public, max-age=86400').catch(next);
  });
}
