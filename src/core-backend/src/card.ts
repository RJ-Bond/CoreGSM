import skia from 'skia-canvas';
import { db, type ServerRow, type StatusRow } from './db.js';

const { Canvas } = skia;

// Discord palette
const C = {
  bg: '#1e1f22',
  panel: '#2b2d31',
  line: '#3f4147',
  text: '#dbdee1',
  mute: '#949ba4',
  blurple: '#5865f2',
  blurpleLight: '#949cf7',
  green: '#23a55a',
  yellow: '#f0b232',
  red: '#f23f42',
};

const MONO = '"DejaVu Sans Mono", "Liberation Mono", monospace';
const W = 1200;
const H = 480;

function fit(ctx: any, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

const cache = new Map<number, { at: number; buf: Buffer }>();

export async function renderCard(serverId: number): Promise<Buffer | null> {
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
  const accent = !st ? C.mute : online ? C.green : C.red;

  const canvas = new Canvas(W, H);
  const ctx: any = canvas.getContext('2d');

  // background + panel
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.panel;
  ctx.beginPath();
  ctx.roundRect(16, 16, W - 32, H - 32, 16);
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  // left accent stripe
  ctx.fillStyle = C.blurple;
  ctx.beginPath();
  ctx.roundRect(16, 16, 10, H - 32, [16, 0, 0, 16]);
  ctx.fill();

  ctx.textBaseline = 'alphabetic';

  // header
  ctx.fillStyle = C.blurpleLight;
  ctx.font = `600 20px ${MONO}`;
  ctx.fillText('▌CORE//GSM', 56, 64);

  const badge = !st ? 'WAITING' : online ? 'ONLINE' : 'OFFLINE';
  ctx.font = `600 22px ${MONO}`;
  const bw = ctx.measureText(badge).width + 56;
  ctx.fillStyle = accent + '26';
  ctx.beginPath();
  ctx.roundRect(W - 56 - bw, 38, bw, 38, 19);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(W - 56 - bw + 20, 57, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillText(badge, W - 56 - bw + 36, 65);

  // title
  ctx.fillStyle = C.text;
  ctx.font = `700 54px ${MONO}`;
  ctx.fillText(fit(ctx, s.name, W - 112), 56, 140);
  ctx.fillStyle = C.mute;
  ctx.font = `400 22px ${MONO}`;
  ctx.fillText(fit(ctx, `${s.game}${st?.version ? ' · ' + st.version : ''}`, W - 112), 56, 176);

  // players block
  ctx.fillStyle = C.mute;
  ctx.font = `600 18px ${MONO}`;
  ctx.fillText('PLAYERS', 56, 236);
  ctx.fillStyle = online ? C.text : C.mute;
  ctx.font = `700 96px ${MONO}`;
  const big = online ? `${players}` : '–';
  ctx.fillText(big, 56, 322);
  const bigW = ctx.measureText(big).width;
  ctx.fillStyle = C.mute;
  ctx.font = `400 44px ${MONO}`;
  ctx.fillText(online && max ? `/ ${max}` : '', 56 + bigW + 14, 322);

  // fill bar
  const barW = 460;
  ctx.fillStyle = C.bg;
  ctx.beginPath();
  ctx.roundRect(56, 346, barW, 14, 7);
  ctx.fill();
  if (online && max > 0) {
    const ratio = Math.min(1, players / max);
    ctx.fillStyle = ratio > 0.9 ? C.yellow : C.blurple;
    ctx.beginPath();
    ctx.roundRect(56, 346, Math.max(14, barW * ratio), 14, 7);
    ctx.fill();
  }

  // stats column
  const sx = 620;
  const stat = (label: string, value: string, y: number, color: string = C.text) => {
    ctx.fillStyle = C.mute;
    ctx.font = `600 16px ${MONO}`;
    ctx.fillText(label, sx, y);
    ctx.fillStyle = color;
    ctx.font = `500 24px ${MONO}`;
    ctx.fillText(fit(ctx, value, 530), sx, y + 30);
  };
  stat('ADDRESS', `${s.host}:${s.port}`, 236);
  stat('MAP', online && st?.map ? st.map : '–', 304);
  const ping = online && st?.ping != null ? `${st.ping} ms` : '–';
  stat('PING', ping, 372, st?.ping != null && st.ping > 100 ? C.yellow : C.text);

  // player names
  if (online && names.length) {
    ctx.fillStyle = C.mute;
    ctx.font = `600 16px ${MONO}`;
    ctx.fillText('ONLINE NOW', sx + 270, 304);
    ctx.fillStyle = C.text;
    ctx.font = `400 20px ${MONO}`;
    names.slice(0, 4).forEach((n, i) => ctx.fillText(fit(ctx, n, 260), sx + 270, 334 + i * 26));
    if (names.length > 4) {
      ctx.fillStyle = C.mute;
      ctx.fillText(`+${names.length - 4} more`, sx + 270, 334 + 4 * 26);
    }
  }

  // sparkline (24h)
  if (hist.length > 1) {
    const x0 = 56;
    const y0 = 380;
    const w = barW;
    const h = 36;
    const top = Math.max(1, max, ...hist.map((p) => p.players));
    ctx.strokeStyle = C.blurpleLight;
    ctx.lineWidth = 2;
    ctx.beginPath();
    hist.forEach((p, i) => {
      const x = x0 + (i / (hist.length - 1)) * w;
      const y = y0 + h - (p.players / top) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = C.mute;
    ctx.font = `400 14px ${MONO}`;
    ctx.fillText('24h', x0 + w + 10, y0 + h);
  }

  // footer
  ctx.fillStyle = C.mute;
  ctx.font = `400 16px ${MONO}`;
  const when = st ? new Date(st.updated_at).toISOString().slice(11, 19) + ' UTC' : '–';
  ctx.fillText(`updated ${when}`, 56, H - 40);

  const buf = (await canvas.toBuffer('png')) as Buffer;
  cache.set(serverId, { at: Date.now(), buf });
  return buf;
}
