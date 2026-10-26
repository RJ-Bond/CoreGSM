/** The small 24-hour online chart under a server's Discord message: a signed public PNG. */
import crypto from 'node:crypto';
import type { Express } from 'express';
import skia from 'skia-canvas';
import { JWT_SECRET } from './config.js';
import { drawOnlineChart, type ChartStep } from './chartDraw.js';
import { chartScale } from './chartLogic.js';
import { db } from './db.js';
import { gameProfile } from './games.js';
import { param } from './http.js';

const { Canvas } = skia;
const POINTS = 48;
const SANS = '"DejaVu Sans", "Liberation Sans", sans-serif';

export const chartSign = (id: number) => crypto.createHmac('sha256', JWT_SECRET).update(`chart:${id}`).digest('hex').slice(0, 20);

/** the busiest moment of each half hour of the last 24 h, and which half hours had the server down */
export function chartSeries(serverId: number, now = Date.now()): { players: (number | null)[]; down: boolean[] } {
  const since = now - 24 * 3600_000;
  const bucket = (24 * 3600_000) / POINTS;
  const rows = db
    .prepare(`SELECT MIN(CAST((ts - ?) / ? AS INTEGER), ${POINTS - 1}) AS b, MAX(players) AS p, MIN(online) AS o FROM history WHERE server_id = ? AND ts > ? GROUP BY b`)
    .all(since, bucket, serverId, since) as { b: number; p: number; o: number }[];
  const players: (number | null)[] = Array(POINTS).fill(null);
  const down: boolean[] = Array(POINTS).fill(false);
  for (const r of rows) {
    players[r.b] = r.p;
    if (!r.o) down[r.b] = true;
  }
  return { players, down };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function renderChart(series: { players: (number | null)[]; down: boolean[] }, color: string): Promise<Buffer> {
  const W = 720;
  const H = 160;
  const canvas = new Canvas(W, H);
  const ctx: any = canvas.getContext('2d');
  ctx.fillStyle = '#2b2d31';
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 14);
  ctx.fill();
  const { values, max } = chartScale(series.players);
  const left = 16;
  const right = W - 16;
  const top = 34;
  const bottom = H - 30;
  const steps: ChartStep[] = series.players.map((p, i) => ({ players: p ?? 0, down: series.down[i] ?? false, empty: p == null }));
  drawOnlineChart(ctx, { x: left, y: top, w: right - left, h: bottom - top }, steps, max, { accent: color, bad: '#f23f42', warn: '#f6b73c', ink: '#ffffff' });
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.font = `600 15px ${SANS}`;
  ctx.fillText('Онлайн за 24 часа', left, 22);
  ctx.textAlign = 'right';
  ctx.fillText(`пик ${Math.max(...values)}`, right, 22);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  ctx.font = `600 13px ${SANS}`;
  ctx.fillText('24 ч назад', left, H - 10);
  ctx.textAlign = 'right';
  ctx.fillText('сейчас', right, H - 10);
  return canvas.toBuffer('png');
}

export function registerServerChart(app: Express): void {
  app.get('/api/server-chart/:id-:sig.png', param('id'), param('sig', /^[0-9a-f]{20}$/), async (req, res, next) => {
    const id = Number(req.params.id);
    if (req.params.sig !== chartSign(id)) return res.status(404).json({ error: 'Не найдено' });
    const row = db.prepare('SELECT game FROM servers WHERE id = ?').get(id) as { game: string } | undefined;
    if (!row) return res.status(404).json({ error: 'Не найдено' });
    try {
      const accent = gameProfile(row.game)?.accent;
      const color = accent == null ? '#5865f2' : `#${accent.toString(16).padStart(6, '0')}`;
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' }).send(await renderChart(chartSeries(id), color));
    } catch (e) {
      next(e);
    }
  });
}
