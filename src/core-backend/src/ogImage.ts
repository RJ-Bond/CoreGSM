/** The picture a pasted link to the panel gets when nothing more specific exists: the brand and the numbers right now. */
import type { Express } from 'express';
import skia from 'skia-canvas';
import { db } from './db.js';
import { monogramColor, ogLine } from './ogLogic.js';
import { brand, logoFile } from './site.js';

const { Canvas, loadImage } = skia;
const SANS = '"DejaVu Sans", "Liberation Sans", sans-serif';

let cache: { at: number; key: string; buf: Buffer } | null = null;

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function renderOgDefault(): Promise<Buffer> {
  const b = brand();
  const row = db
    .prepare('SELECT COUNT(*) AS servers, COALESCE(SUM(st.online), 0) AS online, COALESCE(SUM(CASE WHEN st.online = 1 THEN st.players ELSE 0 END), 0) AS players FROM servers s LEFT JOIN status st ON st.server_id = s.id')
    .get() as { servers: number; online: number; players: number };
  const line = ogLine(row);
  const key = `${b.name}|${b.color}|${b.logoV}|${line}`;
  if (cache && cache.key === key && Date.now() - cache.at < 10 * 60_000) return cache.buf;

  const W = 1200;
  const H = 630;
  const accent = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : monogramColor(b.name);
  const canvas = new Canvas(W, H);
  const ctx: any = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#15122b');
  bg.addColorStop(1, '#0b0a16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(240, 80, 10, 240, 80, 820);
  glow.addColorStop(0, `${accent}99`);
  glow.addColorStop(1, `${accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // the logo (custom, when set) or a tile with the first letter of the name
  const lx = 90, ly = 150, ls = 150;
  let logo: any = null;
  const file = logoFile();
  if (file) {
    try { logo = await loadImage(file); } catch { /* a broken file: the monogram */ }
  }
  if (logo) {
    const k = Math.min(ls / logo.width, ls / logo.height);
    ctx.drawImage(logo, lx + (ls - logo.width * k) / 2, ly + (ls - logo.height * k) / 2, logo.width * k, logo.height * k);
  } else {
    const g = ctx.createLinearGradient(lx, ly, lx + ls, ly + ls);
    g.addColorStop(0, accent);
    g.addColorStop(1, `${accent}99`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(lx, ly, ls, ls, 40);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 88px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText((Array.from(b.name.trim())[0] ?? '?').toUpperCase(), lx + ls / 2, ly + ls / 2 + 31);
    ctx.textAlign = 'left';
  }

  // the name (shrunk to fit), a line of what it is, and the live numbers
  let size = 84;
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${size}px ${SANS}`;
  while (size > 44 && ctx.measureText(b.name).width > W - lx - 90) {
    size -= 4;
    ctx.font = `800 ${size}px ${SANS}`;
  }
  ctx.fillText(b.name, lx, 400);
  ctx.fillStyle = 'rgba(255,255,255,.72)';
  ctx.font = `600 34px ${SANS}`;
  let shown = line;
  while (shown.length > 8 && ctx.measureText(shown).width > W - lx - 90) shown = `${shown.slice(0, -2)}…`;
  ctx.fillText(shown, lx, 462);
  ctx.fillStyle = accent;
  ctx.fillRect(lx, 500, 120, 6);
  const buf = (await canvas.toBuffer('png')) as Buffer;
  cache = { at: Date.now(), key, buf };
  return buf;
}

export function registerOg(app: Express): void {
  app.get('/api/og/default.png', async (_req, res, next) => {
    try {
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=600' }).send(await renderOgDefault());
    } catch (e) {
      next(e);
    }
  });
}
