/** Sends a stored JPEG/PNG; as WebP (usually a third lighter) to browsers that ask for it. */
import fs from 'node:fs';
import type { Request, Response } from 'express';
import skia from 'skia-canvas';
import { ByteLru, wantsWebp } from './imageLogic.js';
import { log } from './logger.js';

const { Canvas, loadImage } = skia;
const webpCache = new ByteLru<Buffer>(48 * 1024 * 1024);

/* eslint-disable @typescript-eslint/no-explicit-any */
async function toWebp(file: string, mtime: number): Promise<Buffer> {
  const key = `${file}:${mtime}`;
  const hit = webpCache.get(key);
  if (hit) return hit;
  const img: any = await loadImage(file);
  const canvas = new Canvas(img.width, img.height);
  canvas.getContext('2d').drawImage(img, 0, 0);
  const buf = (await canvas.toBuffer('webp', { quality: 0.82 })) as Buffer;
  webpCache.set(key, buf);
  return buf;
}

export async function sendImage(req: Request, res: Response, file: string, type: 'image/jpeg' | 'image/png', cacheControl: string): Promise<void> {
  const headers = { 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff', Vary: 'Accept' };
  if (wantsWebp(req.headers.accept)) {
    try {
      const buf = await toWebp(file, fs.statSync(file).mtimeMs);
      res.set({ ...headers, 'Content-Type': 'image/webp' }).send(buf);
      return;
    } catch (e) {
      log.warn('webp conversion failed, sending the original:', (e as Error).message);
    }
  }
  res.set({ ...headers, 'Content-Type': type }).send(fs.readFileSync(file));
}
