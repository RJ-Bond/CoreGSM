import skia from 'skia-canvas';
import { db, type ServerRow, type StatusRow } from './db.js';
import { gameLabel } from './games.js';
import { gameIconPath } from './gameIcons.js';
import { GAME_IMAGES } from './gameImages.js';

const { Canvas, Path2D, loadImage } = skia;

const imageCache = new Map<string, unknown>();
/** artwork for a game (transparent PNG), or null when it only has a line pictogram */
async function gameImage(game: string): Promise<any> {
  const b64 = GAME_IMAGES[game];
  if (!b64) return null;
  if (!imageCache.has(game)) imageCache.set(game, await loadImage(Buffer.from(b64, 'base64')));
  return imageCache.get(game);
}

// Pastel Soft palette (matches the web panel)
const C = {
  page: '#f1effe',
  card: '#ffffff',
  ink: '#2b2650',
  mute: '#7a74a8',
  line: '#e2defa',
  soft: '#ece9ff',
  brand: '#5a4bd1',
  ok: '#168a4f',
  okBg: '#d9f7e6',
  warn: '#b27300',
  warnBg: '#fff0cc',
  bad: '#c53030',
  badBg: '#ffdede',
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

async function renderCardNow(serverId: number): Promise<Buffer | null> {
  const hit = cache.get(serverId);
  if (hit && Date.now() - hit.at < 10_000) return hit.buf;

  const s = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as ServerRow | undefined;
  if (!s) return null;
  const st = db.prepare('SELECT * FROM status WHERE server_id = ?').get(serverId) as StatusRow | undefined;
  const hist = db
    .prepare('SELECT players FROM history WHERE server_id = ? AND ts > ? ORDER BY ts')
    .all(serverId, Date.now() - 24 * 3600 * 1000) as { players: number }[];

  const online = !!st?.online;
  const players = st?.players ?? 0;
  const max = st?.max_players ?? 0;
  const names: string[] = st ? JSON.parse(st.player_names) : [];
  const [abbr, accent] = GAME_COLORS[s.game] ?? [s.game.slice(0, 2).toUpperCase(), C.brand];
  const laggy = online && st?.ping != null && st.ping > 100;

  const canvas = new Canvas(W, H);
  const ctx: any = canvas.getContext('2d');

  // page + white card
  ctx.fillStyle = C.page;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.shadowColor = 'rgba(90, 75, 209, 0.16)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = C.card;
  ctx.beginPath();
  ctx.roundRect(24, 20, W - 48, H - 48, 36);
  ctx.fill();
  ctx.restore();

  ctx.textBaseline = 'alphabetic';

  // game avatar: the artwork sits on a deep tile of the game colour, a pictogram on the colour itself
  const art = await gameImage(s.game);
  ctx.fillStyle = art ? mixToBlack(accent, 0.62) : accent;
  ctx.beginPath();
  ctx.roundRect(64, 56, 84, 84, 26);
  ctx.fill();
  const iconPath = gameIconPath(s.game);
  if (art) {
    ctx.drawImage(art, 106 - 38, 98 - 38, 76, 76);
  } else if (iconPath) {
    // the same pictogram as in the panel: 24x24 grid scaled to ~46px, centred in the 84px square
    ctx.save();
    ctx.translate(106 - 12 * 1.95, 98 - 12 * 1.95);
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
    ctx.fillText(abbr, 106, 109);
  }
  ctx.textAlign = 'left';

  // status pill (top right)
  const label = !st ? 'ОЖИДАНИЕ' : !online ? 'OFFLINE' : laggy ? 'LAG' : 'ONLINE';
  const [pillBg, pillFg] = !st ? [C.soft, C.mute] : !online ? [C.badBg, C.bad] : laggy ? [C.warnBg, C.warn] : [C.okBg, C.ok];
  ctx.font = `700 22px ${SANS}`;
  const pw = ctx.measureText(label).width + 62;
  const px = W - 64 - pw;
  ctx.fillStyle = pillBg;
  ctx.beginPath();
  ctx.roundRect(px, 62, pw, 44, 22);
  ctx.fill();
  ctx.fillStyle = pillFg;
  ctx.beginPath();
  ctx.arc(px + 26, 84, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillText(label, px + 42, 92);

  // title
  const titleX = 172;
  ctx.fillStyle = C.ink;
  ctx.font = `700 44px ${SANS}`;
  // never put the internal query address on a public card: prefer the display address
  const address = s.display_address || `${s.host}:${s.port}`;
  const title = s.name || st?.name || address;
  // long titles: first shrink the font, then wrap onto two lines (ellipsis only if even that is not enough)
  const maxTitleW = px - titleX - 24;
  let titleSize = 44;
  ctx.font = `700 ${titleSize}px ${SANS}`;
  while (titleSize > 36 && ctx.measureText(title).width > maxTitleW) {
    titleSize -= 2;
    ctx.font = `700 ${titleSize}px ${SANS}`;
  }
  let subtitleY = 132;
  if (ctx.measureText(title).width <= maxTitleW) {
    ctx.fillText(title, titleX, 96);
  } else {
    ctx.font = `700 34px ${SANS}`;
    const lines: string[] = [];
    let cur = '';
    for (const word of title.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(next).width <= maxTitleW || !cur) cur = next;
      else { lines.push(cur); cur = word; }
    }
    lines.push(cur);
    // anything beyond two lines is cut with an ellipsis on the second one
    const shown = lines.length > 2 ? [lines[0], `${lines.slice(1).join(' ')}`] : lines;
    shown.forEach((ln, i) => ctx.fillText(fit(ctx, ln, maxTitleW), titleX, 84 + i * 40));
    subtitleY = 84 + (shown.length - 1) * 40 + 36;
  }
  ctx.fillStyle = C.mute;
  ctx.font = `700 22px ${SANS}`;
  ctx.fillText(fit(ctx, `${gameLabel(s.game)}${st?.version ? ' · ' + st.version : ''}`, px - titleX - 24), titleX, subtitleY);

  // players
  ctx.fillStyle = C.mute;
  ctx.font = `700 20px ${SANS}`;
  ctx.fillText('Игроки', 64, 206);
  ctx.fillStyle = online ? C.ink : C.mute;
  ctx.font = `700 100px ${SANS}`;
  const big = online ? `${players}` : '–';
  ctx.fillText(big, 64, 300);
  const bigW = ctx.measureText(big).width;
  if (online && max) {
    ctx.fillStyle = C.mute;
    ctx.font = `700 44px ${SANS}`;
    ctx.fillText(`/ ${max}`, 64 + bigW + 14, 300);
  }

  // fill bar
  const barW = 500;
  ctx.fillStyle = C.soft;
  ctx.beginPath();
  ctx.roundRect(64, 322, barW, 20, 10);
  ctx.fill();
  if (online && max > 0) {
    const ratio = Math.min(1, players / max);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(64, 322, Math.max(20, barW * ratio), 20, 10);
    ctx.fill();
  }

  // sparkline (24h)
  if (hist.length > 1) {
    const x0 = 64, y0 = 362, w = barW, h = 40;
    const top = Math.max(1, max, ...hist.map((p) => p.players));
    const pts = hist.map((p, i) => [x0 + (i / (hist.length - 1)) * w, y0 + h - (p.players / top) * h]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.lineTo(x0 + w, y0 + h);
    ctx.lineTo(x0, y0 + h);
    ctx.closePath();
    ctx.fillStyle = accent + '24';
    ctx.fill();
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // info tiles
  const tile = (x: number, y: number, w: number, k: string, v: string, mono = false, color: string = C.ink) => {
    ctx.fillStyle = C.soft;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 76, 22);
    ctx.fill();
    ctx.fillStyle = C.mute;
    ctx.font = `700 16px ${SANS}`;
    ctx.fillText(k, x + 20, y + 28);
    ctx.fillStyle = color;
    ctx.font = `700 24px ${mono ? MONO : SANS}`;
    ctx.fillText(fit(ctx, v, w - 40), x + 20, y + 58);
  };
  const tx = 640;
  const tw = W - 64 - tx;
  tile(tx, 176, tw, 'Адрес', address, true);
  tile(tx, 264, tw / 2 - 8, 'Карта', online && st?.map ? st.map : '–');
  tile(tx + tw / 2 + 8, 264, tw / 2 - 8, 'Пинг', online && st?.ping != null ? `${st.ping} мс` : '–', false, laggy ? C.warn : C.ink);

  // online players line
  ctx.fillStyle = C.mute;
  ctx.font = `700 18px ${SANS}`;
  const shown = online && names.length ? names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4}` : '') : '';
  if (shown) ctx.fillText(fit(ctx, 'В игре: ' + shown, tw), tx, 380);

  // footer
  ctx.fillStyle = C.mute;
  ctx.font = `700 16px ${SANS}`;
  const when = st ? new Date(st.updated_at).toISOString().slice(11, 19) + ' UTC' : '–';
  ctx.fillText(`Обновлено ${when}`, 64, H - 60 + 24);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.brand;
  ctx.fillText('CoreGSM', W - 64, H - 60 + 24);
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
