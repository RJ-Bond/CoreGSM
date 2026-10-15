import skia from 'skia-canvas';
import { db, type ServerRow, type StatusRow } from './db.js';
import { gameLabel } from './games.js';
import { gameIconPath } from './gameIcons.js';
import { GAME_IMAGES } from './gameImages.js';
import { coverFile } from './covers.js';

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
  const [abbr, accent] = GAME_COLORS[s.game] ?? [s.game.slice(0, 2).toUpperCase(), C.brand];
  const laggy = online && st?.ping != null && st.ping > 100;
  const status = !st ? C.mute : !online ? C.bad : laggy ? C.warn : C.ok;

  const canvas = new Canvas(W, H);
  const ctx: any = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  // the card: the cover (if any) under a dark veil, else a glow of the game colour
  ctx.save();
  rr(ctx, 0, 0, W, H, 32);
  ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, C.bg2);
  bg.addColorStop(1, C.bg);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const file = coverFile(serverId);
  let cover: any = null;
  if (file) {
    try { cover = await loadImage(file); } catch { /* a broken file: no cover */ }
  }
  if (cover) {
    const k = Math.max(W / cover.width, H / cover.height);
    ctx.drawImage(cover, (W - cover.width * k) / 2, (H - cover.height * k) / 2, cover.width * k, cover.height * k);
    const veil = ctx.createLinearGradient(0, 0, W, 0);
    veil.addColorStop(0, 'rgba(12, 10, 24, 0.95)');
    veil.addColorStop(0.5, 'rgba(12, 10, 24, 0.84)');
    veil.addColorStop(1, 'rgba(12, 10, 24, 0.62)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, W, H);
  }
  const glow = ctx.createRadialGradient(W - 140, -40, 0, W - 140, -40, 560);
  glow.addColorStop(0, alpha(accent, cover ? 0.28 : 0.4));
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
  const label = !st ? 'ОЖИДАНИЕ' : !online ? 'OFFLINE' : laggy ? 'LAG' : 'ONLINE';
  ctx.font = `700 21px ${SANS}`;
  const pw = ctx.measureText(label).width + 60;
  const px = W - 48 - pw;
  ctx.fillStyle = alpha(status === C.mute ? '#9a95c4' : status, 0.16);
  rr(ctx, px, 52, pw, 44, 22);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = status;
  ctx.shadowBlur = 12;
  ctx.fillStyle = status;
  ctx.beginPath();
  ctx.arc(px + 26, 74, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = status;
  ctx.fillText(label, px + 42, 82);

  // title: shrink the font first, then wrap onto two lines (ellipsis only if even that is not enough)
  const titleX = 156;
  // never put the internal query address on a public card: prefer the display address
  const address = s.display_address || `${s.host}:${s.port}`;
  const title = s.name || st?.name || address;
  const maxTitleW = px - titleX - 24;
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
  ctx.fillText(fit(ctx, sub, px - titleX - 24), titleX, subtitleY);

  // players: the big number, the fill bar, who is in the game
  ctx.fillStyle = C.mute;
  ctx.font = `700 17px ${SANS}`;
  ctx.fillText('ИГРОКИ', 48, 196);
  ctx.fillStyle = online ? C.ink : C.dim;
  ctx.font = `800 104px ${SANS}`;
  const big = online ? `${players}` : '–';
  ctx.fillText(big, 44, 292);
  const bigW = ctx.measureText(big).width;
  if (online && max) {
    ctx.fillStyle = C.mute;
    ctx.font = `700 40px ${SANS}`;
    ctx.fillText(`/ ${max}`, 44 + bigW + 14, 292);
  }
  const barW = 500;
  ctx.fillStyle = C.soft;
  rr(ctx, 48, 314, barW, 14, 7);
  ctx.fill();
  if (online && max > 0) {
    const fill = ctx.createLinearGradient(48, 0, 48 + barW, 0);
    fill.addColorStop(0, accent);
    fill.addColorStop(1, alpha(accent, 0.7));
    ctx.save();
    ctx.shadowColor = alpha(accent, 0.6);
    ctx.shadowBlur = 14;
    ctx.fillStyle = fill;
    rr(ctx, 48, 314, Math.max(14, barW * Math.min(1, players / max)), 14, 7);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = C.mute;
  ctx.font = `700 18px ${SANS}`;
  const inGame = online && names.length ? names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4}` : '') : '';
  if (inGame) ctx.fillText(fit(ctx, 'В игре: ' + inGame, barW), 48, 362);
  else if (!online && st) ctx.fillText('Сервер сейчас недоступен', 48, 362);

  // the last 24 hours: players, outages in red, the 30-day record as a dashed line
  const gx = 592, gy = 160, gw = W - 48 - gx, gh = 206;
  ctx.fillStyle = cover ? 'rgba(14, 12, 27, 0.6)' : 'rgba(255, 255, 255, 0.045)';
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
  const top = Math.max(1, max, peak, record ?? 0);
  const xAt = (i: number) => cx + (i / (steps.length - 1)) * cw;
  const yAt = (v: number) => cy + ch - (v / top) * ch;
  // outages
  ctx.fillStyle = alpha(C.bad, 0.2);
  steps.forEach((b, i) => { if (!b.empty && b.down) ctx.fillRect(xAt(i) - cw / steps.length / 2, cy, cw / steps.length + 0.5, ch); });
  // the record
  if (record) {
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = alpha(C.warn, 0.55);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, yAt(record));
    ctx.lineTo(cx + cw, yAt(record));
    ctx.stroke();
    ctx.restore();
  }
  // the players line, smooth, with a soft area under it
  if (known.length > 1) {
    const pts = steps.map((b, i) => [xAt(i), yAt(b.players)] as [number, number]);
    const line = () => {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        ctx.bezierCurveTo((x0 + x1) / 2, y0, (x0 + x1) / 2, y1, x1, y1);
      }
    };
    const area = ctx.createLinearGradient(0, cy, 0, cy + ch);
    area.addColorStop(0, alpha(accent, 0.42));
    area.addColorStop(1, alpha(accent, 0));
    ctx.beginPath();
    line();
    ctx.lineTo(cx + cw, cy + ch);
    ctx.lineTo(cx, cy + ch);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();
    ctx.beginPath();
    line();
    ctx.save();
    ctx.shadowColor = alpha(accent, 0.7);
    ctx.shadowBlur = 10;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
    // now
    const [nx, ny] = pts[pts.length - 1];
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.arc(nx, ny, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
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
  const small = (W - 96 - 3 * gap - 380) / 3;
  chip(48, 380, 'АДРЕС', address, C.ink, true);
  chip(48 + 380 + gap, small, 'ПИНГ', online && st?.ping != null ? `${st.ping} мс` : '–', laggy ? C.warn : C.ink);
  chip(48 + 380 + gap + (small + gap), small, 'РЕКОРД 30 ДН', record ? String(record) : '–', record && online && players >= record ? C.warn : C.ink);
  chip(48 + 380 + gap + 2 * (small + gap), small, 'АПТАЙМ 24 Ч', uptime == null ? '–' : `${uptime}%`, uptime != null && uptime < 99 ? C.warn : C.ok);

  // footer
  ctx.fillStyle = C.dim;
  ctx.font = `700 14px ${SANS}`;
  const when = st ? new Date(st.updated_at).toISOString().slice(11, 16) + ' UTC' : '–';
  ctx.fillText(`Обновлено ${when}`, 48, H - 12);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.brand;
  ctx.fillText('CoreGSM', W - 48, H - 12);
  ctx.textAlign = 'left';

  const buf = (await canvas.toBuffer('png')) as Buffer;
  cache.set(serverId, { at: Date.now(), buf });
  return buf;
}

const iconCache = new Map<string, Buffer>();

/** 256px game pictogram (white on the game colour), used as the embed thumbnail */
export async function renderGameIcon(game: string): Promise<Buffer> {
  const hit = iconCache.get(game);
  if (hit) return hit;
  // transparent PNG without a background tile: the game artwork itself, or its pictogram in the game colour
  const color = GAME_COLORS[game]?.[1] ?? C.brand;
  const canvas = new Canvas(256, 256);
  const ctx = canvas.getContext('2d') as any;
  const p = gameIconPath(game);
  const art = await gameImage(game);
  if (art) {
    const k = Math.min(240 / art.width, 240 / art.height);
    const w = art.width * k, h = art.height * k;
    ctx.drawImage(art, (256 - w) / 2, (256 - h) / 2, w, h);
  } else if (p) {
    ctx.translate(128 - 12 * 9, 128 - 12 * 9);
    ctx.scale(9, 9);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(p));
  } else {
    ctx.fillStyle = color;
    ctx.font = `700 96px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(GAME_COLORS[game]?.[0] ?? (game.slice(0, 2).toUpperCase() || '?'), 128, 134);
  }
  const buf = await canvas.toBuffer('png');
  if (iconCache.size >= 100) iconCache.delete(iconCache.keys().next().value as string);
  iconCache.set(game, buf);
  return buf;
}
