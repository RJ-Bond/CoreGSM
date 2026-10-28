import skia from 'skia-canvas';
import { db, type ServerRow, type StatusRow } from './db.js';
import { gameLabel } from './games.js';
import { gameIconPath } from './gameIcons.js';
import { GAME_IMAGES } from './gameImages.js';
import { chartTop, drawOnlineChart } from './chartDraw.js';
import { avatarColor, initialOf, stateBand, whoInGame } from './cardLogic.js';
import { monogramColor, monogramOf } from './ogLogic.js';
import { coverFile } from './covers.js';
import { getSetting } from './db.js';
import { maintenanceFor } from './maintenance.js';

const { Canvas, Path2D, loadImage } = skia;

const imageCache = new Map<string, unknown>();
/** artwork for a game (transparent PNG), or null when it only has a line pictogram */
async function gameImage(game: string): Promise<any> {
  const b64 = GAME_IMAGES[game];
  if (!b64) return null;
  if (!imageCache.has(game)) imageCache.set(game, await loadImage(Buffer.from(b64, 'base64')));
  return imageCache.get(game);
}

// the dark panel palette (matches the web panel's default theme)
const C = {
  bg: '#0e0c1b',
  bg2: '#17142c',
  ink: '#f4f2ff',
  mute: '#9a95c4',
  dim: '#6a6596',
  line: 'rgba(255, 255, 255, 0.08)',
  soft: 'rgba(255, 255, 255, 0.06)',
  brand: '#7b6cf6',
  ok: '#3ddc84',
  warn: '#f6b73c',
  bad: '#ff5d6c',
};

// per-game accent colours (same as the panel); unknown games use the brand colour
const GAME_COLORS: Record<string, [string, string]> = {
  minecraft: ['MC', '#62b543'], mbe: ['MB', '#4fa33a'], counterstrike2: ['CS', '#f0a020'], csgo: ['GO', '#e8962a'],
  counterstrike16: ['1.6', '#d9a441'], css: ['CS', '#d98f3a'], rust: ['RS', '#e0502d'], valheim: ['VH', '#4d8fc7'],
  garrysmod: ['GM', '#3a8fd9'], teamfortress2: ['TF', '#c9533a'], l4d2: ['L4', '#b83a3a'], terraria: ['TR', '#46b86a'],
  sdtd: ['7D', '#b5483a'], dayz: ['DZ', '#6f8f4a'], ase: ['AK', '#3aa6a0'], asa: ['AS', '#2f9ea8'],
  conanexiles: ['CE', '#a8743a'], palworld: ['PW', '#2fc4bf'], factorio: ['FC', '#d98a3a'], unturned: ['UT', '#4aa86a'],
  vrising: ['VR', '#7c3aed'], icarus: ['IC', '#f5b01e'], projectzomboid: ['PZ', '#7a8a4a'], gta5f: ['5M', '#f26a3d'], gtasam: ['SA', '#8a6ad9'],
  teamspeak3: ['TS', '#3a7ad9'],
};

/** "#f5b01e" darkened by `k` (0..1) towards black */
function mixToBlack(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * (1 - k));
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

const SANS = '"DejaVu Sans", "Liberation Sans", sans-serif';
const MONO = '"DejaVu Sans Mono", "Liberation Mono", monospace';
const W = 1200;
const H = 480;
const DAY = 86_400_000;

/* eslint-disable @typescript-eslint/no-explicit-any */
function fit(ctx: any, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

const cache = new Map<number, { at: number; buf: Buffer }>();

const inflight = new Map<number, Promise<Buffer | null>>();

/** Concurrent requests for the same server share one render. */
export function renderCard(serverId: number): Promise<Buffer | null> {
  const running = inflight.get(serverId);
  if (running) return running;
  const p = renderCardNow(serverId).finally(() => inflight.delete(serverId));
  inflight.set(serverId, p);
  return p;
}

/** true for games with their own colour/pictogram; everything else gets the generic icon */
export const isKnownGame = (game: string): boolean => game in GAME_COLORS;

/** a rounded rectangle path */
function rr(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** "#7c3aed" with alpha 0..1 */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** the last 24 hours in 15-minute steps: the most players of each step, and whether the server was down all of it */
function last24h(serverId: number, now: number): { players: number; down: boolean; empty: boolean }[] {
  const STEP = 900_000;
  const n = 96;
  const from = now - n * STEP;
  const out = Array.from({ length: n }, () => ({ players: 0, down: true, empty: true }));
  for (const r of db.prepare('SELECT ts, online, players FROM history WHERE server_id = ? AND ts > ?').iterate(serverId, from) as Iterable<{ ts: number; online: number; players: number }>) {
    const b = out[Math.min(n - 1, Math.floor((r.ts - from) / STEP))];
    b.empty = false;
    if (r.online) {
      b.down = false;
      b.players = Math.max(b.players, r.players);
    }
  }
  return out;
}

async function renderCardNow(serverId: number): Promise<Buffer | null> {
  const hit = cache.get(serverId);
  if (hit && Date.now() - hit.at < 10_000) return hit.buf;

  const s = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as ServerRow | undefined;
  if (!s) return null;
  const st = db.prepare('SELECT * FROM status WHERE server_id = ?').get(serverId) as StatusRow | undefined;
  const now = Date.now();
  const steps = last24h(serverId, now);
  const known = steps.filter((b) => !b.empty);
  const uptime = known.length ? Math.round((known.filter((b) => !b.down).length / known.length) * 1000) / 10 : null;
  const record = (db.prepare('SELECT MAX(players) AS p FROM history WHERE server_id = ? AND ts > ? AND online = 1').get(serverId, now - 30 * DAY) as { p: number | null }).p;

  const online = !!st?.online;
  const players = st?.players ?? 0;
  const max = st?.max_players ?? 0;
  const names: string[] = st ? JSON.parse(st.player_names) : [];
  // a game without a colour of its own gets a monogram and a colour made from its name
  const [abbr, accent] = GAME_COLORS[s.game] ?? [monogramOf(gameLabel(s.game)), monogramColor(s.game)];
  const laggy = online && st?.ping != null && st.ping > 100;
  const maint = maintenanceFor(serverId, now);
  const status = maint ? '#7b8cff' : !st ? C.mute : !online ? C.bad : laggy ? C.warn : C.ok;

  const canvas = new Canvas(W, H);
  const ctx: any = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  // the card: the cover (if any) under a dark veil, else a glow of the game colour
  ctx.save();
  rr(ctx, 0, 0, W, H, 32);
  ctx.clip();
  // layout «split»: the picture of the game on the left (it melts into the card), the figures on the right
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, C.bg2);
  bg.addColorStop(1, C.bg);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const PW = 600;
  const file = coverFile(serverId);
  let cover: any = null;
  if (file) {
    try { cover = await loadImage(file); } catch { /* a broken file: no cover */ }
  }
  // the picture lives on its own layer, so its right edge can fade to nothing (and show the card's own background)
  const layer = new Canvas(PW, H);
  const lg: any = layer.getContext('2d');
  if (cover) {
    const k = Math.max(PW / cover.width, H / cover.height);
    lg.drawImage(cover, (PW - cover.width * k) / 2, (H - cover.height * k) / 2, cover.width * k, cover.height * k);
  } else {
    const g0 = lg.createRadialGradient(220, 220, 0, 220, 220, 420);
    g0.addColorStop(0, alpha(accent, 0.55));
    g0.addColorStop(1, alpha(accent, 0));
    lg.fillStyle = g0;
    lg.fillRect(0, 0, PW, H);
    const art0 = await gameImage(s.game);
    if (art0) {
      lg.globalAlpha = 0.4;
      lg.drawImage(art0, 110, 90, 280, 280);
      lg.globalAlpha = 1;
    }
  }
  // the bottom is darker under the status and the address
  const low = lg.createLinearGradient(0, H * 0.5, 0, H);
  low.addColorStop(0, 'rgba(14, 12, 27, 0)');
  low.addColorStop(1, 'rgba(14, 12, 27, 0.8)');
  lg.fillStyle = low;
  lg.fillRect(0, 0, PW, H);
  // the right edge melts away
  lg.globalCompositeOperation = 'destination-out';
  const melt = lg.createLinearGradient(PW * 0.4, 0, PW, 0);
  melt.addColorStop(0, 'rgba(0, 0, 0, 0)');
  melt.addColorStop(1, 'rgba(0, 0, 0, 1)');
  lg.fillStyle = melt;
  lg.fillRect(0, 0, PW, H);
  ctx.drawImage(layer, 0, 0);
  const glow = ctx.createRadialGradient(W - 140, -40, 0, W - 140, -40, 520);
  glow.addColorStop(0, alpha(accent, 0.22));
  glow.addColorStop(1, alpha(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // a thin line of the status colour along the top
  ctx.fillStyle = status;
  ctx.fillRect(0, 0, W, 5);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 2;
  rr(ctx, 1, 1, W - 2, H - 2, 31);
  ctx.stroke();

  // game avatar: the artwork on a deep tile of the game colour, a pictogram on the colour itself
  const art = await gameImage(s.game);
  const grad = ctx.createLinearGradient(48, 44, 132, 128);
  grad.addColorStop(0, art ? mixToBlack(accent, 0.45) : accent);
  grad.addColorStop(1, art ? mixToBlack(accent, 0.75) : mixToBlack(accent, 0.3));
  ctx.save();
  ctx.shadowColor = alpha(accent, 0.5);
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = grad;
  rr(ctx, 48, 44, 84, 84, 26);
  ctx.fill();
  ctx.restore();
  const iconPath = gameIconPath(s.game);
  if (art) {
    ctx.drawImage(art, 90 - 38, 86 - 38, 76, 76);
  } else if (iconPath) {
    // the same pictogram as in the panel: 24x24 grid scaled to ~46px, centred in the 84px square
    ctx.save();
    ctx.translate(90 - 12 * 1.95, 86 - 12 * 1.95);
    ctx.scale(1.95, 1.95);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(iconPath));
    ctx.restore();
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${abbr.length > 2 ? 28 : 34}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(abbr, 90, 97);
    ctx.textAlign = 'left';
  }

  // status pill (top right)
  const label = maint ? 'ОБСЛУЖИВАНИЕ' : !st ? 'ОЖИДАНИЕ' : !online ? 'OFFLINE' : laggy ? 'LAG' : 'ONLINE';
  ctx.font = `700 21px ${SANS}`;
  const pw = ctx.measureText(label).width + 60;
  const px = 48;
  ctx.fillStyle = alpha(status === C.mute ? '#9a95c4' : status, 0.16);
  rr(ctx, px, 354, pw, 44, 22);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = status;
  ctx.shadowBlur = 12;
  ctx.fillStyle = status;
  ctx.beginPath();
  ctx.arc(px + 26, 376, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = status;
  ctx.fillText(label, px + 42, 384);
  // the address, on the picture
  ctx.fillStyle = C.ink;
  ctx.font = `600 22px ${MONO}`;
  ctx.fillText(fit(ctx, s.display_address || `${s.host}:${s.port}`, 470), 48, 436);

  // title: shrink the font first, then wrap onto two lines (ellipsis only if even that is not enough)
  const titleX = 520;
  // never put the internal query address on a public card: prefer the display address
  const address = s.display_address || `${s.host}:${s.port}`;
  const title = s.name || st?.name || address;
  const maxTitleW = W - 48 - titleX;
  let titleSize = 44;
  ctx.fillStyle = C.ink;
  ctx.font = `800 ${titleSize}px ${SANS}`;
  while (titleSize > 34 && ctx.measureText(title).width > maxTitleW) {
    titleSize -= 2;
    ctx.font = `800 ${titleSize}px ${SANS}`;
  }
  let subtitleY = 120;
  if (ctx.measureText(title).width <= maxTitleW) {
    ctx.fillText(title, titleX, 86);
  } else {
    ctx.font = `800 32px ${SANS}`;
    const lines: string[] = [];
    let cur = '';
    for (const word of title.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(next).width <= maxTitleW || !cur) cur = next;
      else { lines.push(cur); cur = word; }
    }
    lines.push(cur);
    const shown = lines.length > 2 ? [lines[0], lines.slice(1).join(' ')] : lines;
    shown.forEach((ln, i) => ctx.fillText(fit(ctx, ln, maxTitleW), titleX, 74 + i * 36));
    subtitleY = 74 + (shown.length - 1) * 36 + 34;
  }
  ctx.fillStyle = C.mute;
  ctx.font = `700 21px ${SANS}`;
  const sub = [gameLabel(s.game), st?.version, online ? st?.map : null].filter(Boolean).join(' · ');
  ctx.fillText(fit(ctx, sub, W - 48 - titleX), titleX, subtitleY);

  // players: the big number, the fill bar, who is in the game
  ctx.fillStyle = C.mute;
  ctx.font = `700 17px ${SANS}`;
  ctx.fillText('ИГРОКИ', 520, 196);
  ctx.fillStyle = online ? C.ink : C.dim;
  ctx.font = `800 104px ${SANS}`;
  const big = online ? `${players}` : '–';
  ctx.fillText(big, 516, 292);
  const bigW = ctx.measureText(big).width;
  if (online && max) {
    ctx.fillStyle = C.mute;
    ctx.font = `700 40px ${SANS}`;
    ctx.fillText(`/ ${max}`, 516 + bigW + 14, 292);
  }
  const barW = W - 48 - 520;
  ctx.fillStyle = C.soft;
  rr(ctx, 520, 314, barW, 14, 7);
  ctx.fill();
  if (online && max > 0) {
    const fill = ctx.createLinearGradient(520, 0, 520 + barW, 0);
    fill.addColorStop(0, accent);
    fill.addColorStop(1, alpha(accent, 0.7));
    ctx.save();
    ctx.shadowColor = alpha(accent, 0.6);
    ctx.shadowBlur = 14;
    ctx.fillStyle = fill;
    rr(ctx, 520, 314, Math.max(14, barW * Math.min(1, players / max)), 14, 7);
    ctx.fill();
    ctx.restore();
  }
  // who is in the game: round avatars with the first letter and the nick; the rest as «+N»
  if (online && names.length) {
    const who = whoInGame(names, 4);
    const list = who.rest > 0 ? who.shown.slice(0, 3) : who.shown;
    const more = who.rest > 0 ? who.rest + 1 : 0;
    const slotW = barW / 4;
    const r = 15;
    const cy0 = 354;
    list.forEach((nick, i) => {
      const x0 = 520 + i * slotW;
      ctx.fillStyle = avatarColor(nick);
      ctx.beginPath();
      ctx.arc(x0 + r, cy0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0e0c1b';
      ctx.font = `800 17px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText(initialOf(nick), x0 + r, cy0 + 6);
      ctx.textAlign = 'left';
      ctx.fillStyle = C.mute;
      ctx.font = `700 16px ${SANS}`;
      ctx.fillText(fit(ctx, nick, slotW - r * 2 - 18), x0 + r * 2 + 8, cy0 + 6);
    });
    if (more) {
      const x0 = 520 + list.length * slotW;
      ctx.fillStyle = C.soft;
      ctx.beginPath();
      ctx.arc(x0 + r, cy0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.font = `800 14px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText(`+${more}`, x0 + r, cy0 + 5);
      ctx.textAlign = 'left';
    }
  } else if (!online && st) {
    ctx.fillStyle = C.mute;
    ctx.font = `700 18px ${SANS}`;
    ctx.fillText('Сервер сейчас недоступен', 520, 362);
  }

  // the last 24 hours: players, outages in red, the 30-day record as a dashed line
  const gx = 840, gy = 134, gw = W - 48 - gx, gh = 166;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
  rr(ctx, gx, gy, gw, gh, 24);
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = C.mute;
  ctx.font = `700 17px ${SANS}`;
  ctx.fillText('ЗА 24 ЧАСА', gx + 22, gy + 34);
  const peak = Math.max(0, ...steps.map((b) => b.players));
  ctx.textAlign = 'right';
  ctx.fillText(known.length ? `пик ${peak}` : 'нет данных', gx + gw - 22, gy + 34);
  ctx.textAlign = 'left';
  const cx = gx + 22, cy = gy + 52, cw = gw - 44, ch = gh - 74;
  drawOnlineChart(ctx, { x: cx, y: cy, w: cw, h: ch }, steps, chartTop(steps, max, record), { accent, bad: C.bad, warn: C.warn, ink: C.ink }, record);
  ctx.fillStyle = C.dim;
  ctx.font = `700 14px ${SANS}`;
  ctx.fillText('−24 ч', cx, gy + gh - 8);
  ctx.textAlign = 'right';
  ctx.fillText('сейчас', cx + cw, gy + gh - 8);
  ctx.textAlign = 'left';

  // chips: address, ping, the record, uptime
  const chip = (x: number, w: number, k: string, v: string, color: string = C.ink, mono = false) => {
    ctx.fillStyle = C.soft;
    rr(ctx, x, 388, w, 60, 18);
    ctx.fill();
    ctx.fillStyle = C.mute;
    ctx.font = `700 14px ${SANS}`;
    ctx.fillText(k, x + 18, 410);
    ctx.fillStyle = color;
    ctx.font = `700 21px ${mono ? MONO : SANS}`;
    ctx.fillText(fit(ctx, v, w - 36), x + 18, 437);
  };
  const gap = 12;
  const cwid = (W - 48 - 520 - 2 * gap) / 3;
  chip(520, cwid, 'ПИНГ', online && st?.ping != null ? `${st.ping} мс` : '–', laggy ? C.warn : C.ink);
  chip(520 + cwid + gap, cwid, 'РЕКОРД 30 ДН', record ? String(record) : '–', record && online && players >= record ? C.warn : C.ink);
  chip(520 + 2 * (cwid + gap), cwid, 'АПТАЙМ 24 Ч', uptime == null ? '–' : `${uptime}%`, uptime != null && uptime < 99 ? C.warn : C.ok);

  // footer
  ctx.fillStyle = C.dim;
  ctx.font = `700 14px ${SANS}`;
  const when = st ? new Date(st.updated_at).toISOString().slice(11, 16) + ' UTC' : '–';
  ctx.fillText(`Обновлено ${when}`, 48, H - 12);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.brand;
  ctx.fillText('CoreGSM', W - 48, H - 12);
  ctx.textAlign = 'left';

  // a server that is down or under maintenance: the card dims and a banner crosses it, so the preview in a chat says it at once
  const band = stateBand({ known: !!st, online, since: st?.state_since ?? null, maintenanceUntil: maint?.until ?? null }, getSetting('timezone') || process.env.TZ || 'Europe/Moscow');
  if (band) {
    ctx.save();
    rr(ctx, 0, 0, W, H, 32);
    ctx.clip();
    ctx.fillStyle = 'rgba(10, 8, 20, 0.5)';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-0.16);
    const color = band.kind === 'maint' ? '#7b8cff' : C.bad;
    ctx.fillStyle = alpha(color, 0.92);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 24;
    ctx.fillRect(-W, -46, W * 2, 92);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 46px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(band.text, 0, 16);
    ctx.restore();
  }

  const buf = (await canvas.toBuffer('png')) as Buffer;
  cache.set(serverId, { at: Date.now(), buf });
  return buf;
}

const iconCache = new Map<string, Buffer>();

/** 256px game pictogram (white on the game colour), used as the embed thumbnail */
export async function renderGameIcon(game: string, tile = false): Promise<Buffer> {
  const cacheKey = tile ? `${game}:tile` : game;
  const hit = iconCache.get(cacheKey);
  if (hit) return hit;
  // transparent PNG without a background tile: the game artwork itself, or its pictogram in the game colour.
  // `tile`: the same on a rounded tile of the game colour, so the icon reads on a light Discord theme as well as on a dark one
  const color = GAME_COLORS[game]?.[1] ?? monogramColor(game);
  const canvas = new Canvas(256, 256);
  const ctx = canvas.getContext('2d') as any;
  const p = gameIconPath(game);
  const art = await gameImage(game);
  if (tile) {
    const g = ctx.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, mixToBlack(color, art ? 0.45 : 0.05));
    g.addColorStop(1, mixToBlack(color, art ? 0.75 : 0.35));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 240, 56);
    ctx.fill();
  }
  const pad = tile ? 150 : 240;
  if (art) {
    const k = Math.min(pad / art.width, pad / art.height);
    const w = art.width * k, h = art.height * k;
    ctx.drawImage(art, (256 - w) / 2, (256 - h) / 2, w, h);
  } else if (p) {
    const sc = tile ? 6.2 : 9;
    ctx.translate(128 - 12 * sc, 128 - 12 * sc);
    ctx.scale(sc, sc);
    ctx.strokeStyle = tile ? '#ffffff' : color;
    ctx.lineWidth = 1.9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(p));
  } else {
    // a game with neither artwork nor pictogram: a monogram
    ctx.fillStyle = tile ? '#ffffff' : color;
    ctx.font = `700 96px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(GAME_COLORS[game]?.[0] ?? monogramOf(gameLabel(game)), 128, 134);
  }
  const buf = await canvas.toBuffer('png');
  if (iconCache.size >= 100) iconCache.delete(iconCache.keys().next().value as string);
  iconCache.set(cacheKey, buf);
  return buf;
}
