/**
 * A picture of a player's profile to share (Discord, a forum): the name, the rank, the last 30 days of play.
 *
 *   GET /api/u/:username/card.png      only for a public profile; what the owner hid is not drawn
 */
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import skia from 'skia-canvas';
import { db } from '../db.js';
import { brand } from '../admin/site.js';
import { computeStats, playerOf } from '../profile/profileCore.js';
import { rankForHours } from '../profile/ranks.js';
import { vrHoursOf } from '../profile/profileVr.js';
import { hueOf, hoursText, initialOf } from './profileCardLogic.js';

const { Canvas } = skia;
const SANS = '"DejaVu Sans", "Liberation Sans", sans-serif';
const W = 1200;
const H = 630;

export interface ProfileCardData {
  username: string;
  role: string;
  rank: { name: string; color: string } | null;
  stats: { hours: number; sessions: number; streakDays: number; favourite: string | null } | null;
  playingNow: string | null;
  bio: string;
}

/** null when there is no such user or the profile is not public */
export function profileCardData(username: string): ProfileCardData | null {
  const u = db.prepare("SELECT id, username, role FROM users WHERE ulower(username) = ? AND status = 'active'").get(username.trim().toLowerCase()) as
    | { id: number; username: string; role: string }
    | undefined;
  if (!u) return null;
  const p = playerOf(u.id);
  if (!p.publicProfile) return null;
  const { stats } = computeStats(u.id, 30);
  const r = p.privacy.stats ? rankForHours(vrHoursOf(u.id, p.gameNick).hours) : null;
  return {
    username: u.username,
    role: u.role,
    rank: r ? { name: r.name, color: r.color } : null,
    stats: p.privacy.stats ? { hours: stats.totalSeconds / 3600, sessions: stats.sessions, streakDays: stats.streakDays, favourite: stats.byServer[0]?.name ?? null } : null,
    playingNow: p.privacy.online && p.gameNick && stats.playingNow ? stats.playingNow.name : null,
    bio: p.bio,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** the text in at most two lines of the given width: it breaks at a space when it can and at the width when it cannot */
export function splitLines(ctx: any, text: string, maxW: number): [string, string] {
  const words = text.split(/\s+/).filter(Boolean);
  let first = '';
  let i = 0;
  while (i < words.length && ctx.measureText(first ? `${first} ${words[i]}` : words[i]).width <= maxW) first = first ? `${first} ${words[i++]}` : words[i++];
  if (first) return [first, words.slice(i).join(' ')];
  // one word wider than the line: cut it by characters
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut).width > maxW) cut = cut.slice(0, -1);
  return [cut, text.slice(cut.length)];
}

const fit = (ctx: any, text: string, maxW: number): string => {
  let s = text;
  while (s.length > 2 && ctx.measureText(s).width > maxW) s = `${s.slice(0, -2)}…`;
  return s;
};

export async function renderProfileCard(d: ProfileCardData): Promise<Buffer> {
  const b = brand();
  const accent = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#7b6cf6';
  const canvas = new Canvas(W, H);
  const ctx: any = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#17142c');
  bg.addColorStop(1, '#0b0a16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // a soft glow of the brand colour in the corner
  const glow = ctx.createRadialGradient(W, 0, 0, W, 0, 620);
  glow.addColorStop(0, `${accent}55`);
  glow.addColorStop(1, `${accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // the avatar: a circle with the first letter on a colour taken from the name
  const hue = hueOf(d.username);
  const ax = 150;
  const ay = 170;
  const ar = 78;
  ctx.beginPath();
  ctx.arc(ax, ay, ar + 8, 0, Math.PI * 2);
  ctx.fillStyle = d.rank?.color ?? accent;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ax, ay, ar, 0, Math.PI * 2);
  ctx.fillStyle = `hsl(${hue} 62% 46%)`;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 84px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initialOf(d.username), ax, ay + 4);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // the name, the rank and the line under them
  const tx = 270;
  let size = 76;
  ctx.font = `800 ${size}px ${SANS}`;
  while (size > 40 && ctx.measureText(d.username).width > W - tx - 60) {
    size -= 4;
    ctx.font = `800 ${size}px ${SANS}`;
  }
  ctx.fillStyle = '#f4f2ff';
  ctx.fillText(d.username, tx, 160);
  if (d.rank) {
    ctx.fillStyle = d.rank.color;
    ctx.font = `700 34px ${SANS}`;
    ctx.fillText(d.rank.name, tx, 212);
  }
  const sub = d.playingNow ? `▶ ${d.playingNow}` : d.bio;
  if (sub) {
    ctx.fillStyle = d.playingNow ? '#3ddc84' : 'rgba(244,242,255,.7)';
    ctx.font = `600 28px ${SANS}`;
    ctx.fillText(fit(ctx, sub.replace(/\s+/g, ' '), W - tx - 60), tx, 262);
  }

  // four tiles with the numbers of the last 30 days
  if (d.stats) {
    const tiles: [string, string][] = [
      [hoursText(d.stats.hours), 'за 30 дней'],
      [String(d.stats.sessions), 'заходов'],
      [`${d.stats.streakDays}`, 'дней подряд'],
      [d.stats.favourite ?? '—', 'любимый сервер'],
    ];
    const gap = 24;
    const tw = (W - 100 - gap * 3) / 4;
    tiles.forEach(([value, label], i) => {
      const x = 50 + i * (tw + gap);
      const y = 340;
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      ctx.beginPath();
      ctx.roundRect(x, y, tw, 170, 24);
      ctx.fill();
      ctx.fillStyle = '#f4f2ff';
      let vs = 52;
      ctx.font = `800 ${vs}px ${SANS}`;
      while (vs > 36 && ctx.measureText(value).width > tw - 40) {
        vs -= 4;
        ctx.font = `800 ${vs}px ${SANS}`;
      }
      if (ctx.measureText(value).width <= tw - 40) {
        ctx.fillText(value, x + 20, y + 80);
      } else {
        // a long text (a server name): two lines of a smaller size, the end cut with «…»
        ctx.font = `800 30px ${SANS}`;
        const [l1, l2] = splitLines(ctx, value, tw - 40);
        ctx.fillText(l1, x + 20, y + 66);
        if (l2) ctx.fillText(fit(ctx, l2, tw - 40), x + 20, y + 102);
      }
      ctx.fillStyle = '#9a95c4';
      ctx.font = `600 21px ${SANS}`;
      ctx.fillText(fit(ctx, label, tw - 40), x + 20, y + 142);
    });
  }

  // the signature of the panel
  ctx.fillStyle = accent;
  ctx.fillRect(50, 568, 64, 6);
  ctx.fillStyle = 'rgba(244,242,255,.75)';
  ctx.font = `700 26px ${SANS}`;
  ctx.fillText(b.name, 130, 580);
  return (await canvas.toBuffer('png')) as Buffer;
}

/** a picture is drawn once for five minutes: the drawing is the expensive part, a request for it must not be */
const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; buf: Buffer }>();
export const profileCardCacheSize = (): number => cache.size;

export function registerProfileCard(app: Express, limiter: (max: number) => RequestHandler): void {
  app.get('/api/u/:username/card.png', limiter(30), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const d = profileCardData(String(req.params.username ?? ''));
      if (!d) return void res.status(404).end();
      const b = brand();
      const key = `${b.name}|${b.color}|${JSON.stringify(d)}`;
      const hit = cache.get(key);
      let buf: Buffer;
      if (hit && Date.now() - hit.at < CACHE_MS) buf = hit.buf;
      else {
        buf = await renderProfileCard(d);
        // the oldest entries go first once the cache is full
        if (cache.size >= CACHE_MAX) for (const k of [...cache.keys()].slice(0, cache.size - CACHE_MAX + 1)) cache.delete(k);
        cache.set(key, { at: Date.now(), buf });
      }
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' }).send(buf);
    } catch (e) {
      next(e);
    }
  });
}
