/**
 * Weekly digest: once a week (the weekday and hour of the panel's time zone are set in the panel) the bot posts a
 * summary of the last seven days to the alerts channel or a channel of its own: players, peak, hours played,
 * availability and outages of every server, the top players, and the change against the week before. The picture
 * is drawn here (skia, like the server cards) and served at a signed address so that Discord can fetch it even
 * when the panel is private.
 */
import crypto from 'node:crypto';
import skia from 'skia-canvas';
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { alertSettings, enqueueAlert } from './alerts.js';
import { JWT_SECRET } from './config.js';
import { db, EFFECTIVE_NAME, getSetting, setSetting } from './db.js';
import { incidentsSince } from './incidents.js';
import { localParts } from './localTime.js';
import { brand, publicBase } from './site.js';
import { param } from './http.js';

const { Canvas } = skia;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

export const digestSettings = () => ({
  enabled: getSetting('digest_enabled') === '1',
  channelId: getSetting('digest_channel') ?? '',
  weekday: Math.min(6, Math.max(0, Number(getSetting('digest_weekday') ?? 0) || 0)), // 0 = Monday
  hour: Math.min(23, Math.max(0, Number(getSetting('digest_hour') ?? 10) || 0)),
  lastSent: Number(getSetting('digest_last_sent')) || 0,
});

const tz = () => getSetting('timezone') || process.env.TZ || 'Europe/Moscow';

export interface DigestServer {
  id: number; name: string; game: string; players: number; prevPlayers: number; peak: number; peakAt: number | null;
  hours: number; uptime: number | null; incidents: number; downMinutes: number;
}
export interface Digest {
  from: number; to: number;
  totals: { players: number; prevPlayers: number; peak: number; peakAt: number | null; peakServer: string | null; hours: number; prevHours: number; uptime: number | null; incidents: number; newPlayers: number };
  days: { day: string; players: number }[];
  servers: DigestServer[];
  top: { name: string; hours: number }[];
}

/** the summary of the seven days that end at `to` */
export function buildDigest(to = Date.now()): Digest {
  const from = to - WEEK;
  const prevFrom = from - WEEK;
  const servers = db.prepare(`SELECT s.id, ${EFFECTIVE_NAME} AS name, s.game FROM servers s LEFT JOIN status st ON st.server_id = s.id ORDER BY s.id`).all() as { id: number; name: string; game: string }[];
  const visits = db
    .prepare('SELECT server_id AS s, ulower(name) AS k, name, joined_at AS j, COALESCE(left_at, ?) AS l FROM player_sessions WHERE COALESCE(left_at, ?) > ? AND joined_at < ?')
    .all(to, to, prevFrom, to) as { s: number; k: string; name: string; j: number; l: number }[];
  const firstSeen = new Map((db.prepare('SELECT ulower(name) AS k, MIN(joined_at) AS t FROM player_sessions GROUP BY k').all() as { k: string; t: number }[]).map((r) => [r.k, r.t]));
  const clip = (j: number, l: number, a: number, b: number) => Math.max(0, Math.min(l, b) - Math.max(j, a)) / 3600_000;
  const incidents = incidentsSince(from, undefined, to).filter((i) => !i.planned);
  const tzName = tz();

  const perServer: DigestServer[] = servers.map((sv) => {
    const mine = visits.filter((v) => v.s === sv.id);
    const cur = mine.filter((v) => v.l > from);
    const prev = mine.filter((v) => v.j < from);
    const peak = db.prepare('SELECT players, ts FROM history WHERE server_id = ? AND ts > ? AND ts <= ? ORDER BY players DESC, ts DESC LIMIT 1').get(sv.id, from, to) as { players: number; ts: number } | undefined;
    const up = db.prepare('SELECT SUM(up) AS u, SUM(total) AS t FROM uptime_daily WHERE server_id = ? AND day >= ?').get(sv.id, new Date(from).toISOString().slice(0, 10)) as { u: number | null; t: number | null };
    const inc = incidents.filter((i) => i.serverId === sv.id);
    return {
      id: sv.id,
      name: sv.name,
      game: sv.game,
      players: new Set(cur.map((v) => v.k)).size,
      prevPlayers: new Set(prev.map((v) => v.k)).size,
      peak: peak?.players ?? 0,
      peakAt: peak?.ts ?? null,
      hours: Math.round(cur.reduce((n, v) => n + clip(v.j, v.l, from, to), 0)),
      uptime: up.t ? Math.round((up.u! / up.t) * 1000) / 10 : null,
      incidents: inc.length,
      downMinutes: inc.reduce((n, i) => n + Math.round((Math.min(i.end ?? to, to) - Math.max(i.start, from)) / 60_000), 0),
    };
  });

  const cur = visits.filter((v) => v.l > from);
  const prev = visits.filter((v) => v.j < from);
  const days = Array.from({ length: 7 }, (_, i) => localParts(from + (i + 0.5) * DAY, tzName).day);
  const byDay = new Map(days.map((d) => [d, new Set<string>()]));
  for (const v of cur) byDay.get(localParts(Math.max(v.j, from), tzName).day)?.add(v.k);
  const per = new Map<string, { name: string; hours: number }>();
  for (const v of cur) {
    const p = per.get(v.k) ?? { name: v.name, hours: 0 };
    p.hours += clip(v.j, v.l, from, to);
    per.set(v.k, p);
  }
  const best = [...perServer].sort((a, b) => b.peak - a.peak)[0];
  const ups = perServer.map((s) => s.uptime).filter((v): v is number => v != null);
  return {
    from,
    to,
    totals: {
      players: new Set(cur.map((v) => v.k)).size,
      prevPlayers: new Set(prev.map((v) => v.k)).size,
      peak: best?.peak ?? 0,
      peakAt: best?.peakAt ?? null,
      peakServer: best && best.peak > 0 ? best.name : null,
      hours: Math.round(cur.reduce((n, v) => n + clip(v.j, v.l, from, to), 0)),
      prevHours: Math.round(prev.reduce((n, v) => n + clip(v.j, v.l, prevFrom, from), 0)),
      uptime: ups.length ? Math.round((ups.reduce((a, b) => a + b, 0) / ups.length) * 10) / 10 : null,
      incidents: incidents.length,
      newPlayers: new Set(cur.filter((v) => (firstSeen.get(v.k) ?? 0) > from).map((v) => v.k)).size,
    },
    days: days.map((day) => ({ day, players: byDay.get(day)?.size ?? 0 })),
    servers: perServer,
    top: [...per.values()].sort((a, b) => b.hours - a.hours).slice(0, 5).map((p) => ({ name: p.name, hours: Math.round(p.hours * 10) / 10 })),
  };
}

const delta = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
const deltaText = (d: number | null) => (d == null ? '' : d === 0 ? ' (как неделей раньше)' : ` (${d > 0 ? '+' : '−'}${Math.abs(d)}% к прошлой неделе)`);
const dateRu = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: tz() });

// ---------- the picture ----------
const SANS = '"DejaVu Sans", "Liberation Sans", sans-serif';

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function renderDigest(d: Digest): Promise<Buffer> {
  const W = 1200;
  const H = 675;
  const canvas = new Canvas(W, H);
  const ctx: any = canvas.getContext('2d');
  const b = brand();
  const accent = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#5a4bd1';

  // background: deep night with the brand colour glowing from the top left
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#15122b');
  bg.addColorStop(1, '#0b0a16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(160, 40, 10, 160, 40, 700);
  glow.addColorStop(0, `${accent}88`);
  glow.addColorStop(1, `${accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 44px ${SANS}`;
  ctx.fillText(`Неделя на ${b.name}`, 56, 92);
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.font = `600 22px ${SANS}`;
  ctx.fillText(`${dateRu(d.from)} – ${dateRu(d.to)}`, 56, 128);

  // four numbers
  const stats: [string, string, string][] = [
    [String(d.totals.players), 'игроков', deltaText(delta(d.totals.players, d.totals.prevPlayers)).replace(/[()]/g, '').trim()],
    [String(d.totals.peak), 'пик онлайна', d.totals.peakServer ?? ''],
    [d.totals.hours.toLocaleString('ru-RU'), 'часов в игре', deltaText(delta(d.totals.hours, d.totals.prevHours)).replace(/[()]/g, '').trim()],
    [d.totals.uptime == null ? '–' : `${String(d.totals.uptime).replace('.', ',')}%`, 'доступность', d.totals.incidents ? `${d.totals.incidents} сбоев` : 'без сбоев'],
  ];
  stats.forEach(([v, k, hint], i) => {
    const x = 56 + i * 276;
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath();
    ctx.roundRect(x, 160, 256, 140, 22);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 52px ${SANS}`;
    ctx.fillText(v, x + 22, 228);
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.font = `bold 20px ${SANS}`;
    ctx.fillText(k, x + 22, 260);
    ctx.fillStyle = hint.startsWith('−') ? '#ff8a8a' : hint.startsWith('+') ? '#7ee2a8' : 'rgba(255,255,255,.55)';
    ctx.font = `600 15px ${SANS}`;
    let short = hint;
    while (short.length > 3 && ctx.measureText(short).width > 220) short = short.slice(0, -1);
    ctx.fillText(short === hint ? short : `${short}…`, x + 22, 286);
  });

  // players per day
  const max = Math.max(1, ...d.days.map((x) => x.players));
  const bx = 56;
  const by = 340;
  const bw = 520;
  const bh = 270;
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.font = `bold 18px ${SANS}`;
  ctx.fillText('Игроков в день', bx, by);
  const slot = bw / 7;
  d.days.forEach((x, i) => {
    const h = Math.max(4, ((bh - 70) * x.players) / max);
    const gx = bx + i * slot + 10;
    const gy = by + bh - 40 - h;
    const g = ctx.createLinearGradient(0, gy, 0, gy + h);
    g.addColorStop(0, accent);
    g.addColorStop(1, `${accent}66`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(gx, gy, slot - 20, h, 10);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 17px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(x.players), gx + (slot - 20) / 2, gy - 8);
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.font = `600 15px ${SANS}`;
    const [, m, day] = x.day.split('-');
    ctx.fillText(`${Number(day)}.${m}`, gx + (slot - 20) / 2, by + bh - 12);
    ctx.textAlign = 'left';
  });

  // servers
  const sx = 640;
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.font = `bold 18px ${SANS}`;
  ctx.fillText('Серверы', sx, by);
  d.servers.slice(0, 5).forEach((s, i) => {
    const y = by + 22 + i * 50;
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.beginPath();
    ctx.roundRect(sx, y, 504, 42, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 18px ${SANS}`;
    let name = s.name;
    while (name.length > 3 && ctx.measureText(name).width > 250) name = name.slice(0, -1);
    ctx.fillText(name === s.name ? name : `${name}…`, sx + 14, y + 28);
    ctx.font = `600 16px ${SANS}`;
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillText(`${s.players} игр.`, sx + 290, y + 28);
    const ok = s.incidents === 0;
    ctx.fillStyle = ok ? '#7ee2a8' : s.downMinutes >= 60 ? '#ff8a8a' : '#ffd27a';
    ctx.fillText(s.uptime == null ? '–' : `${String(s.uptime).replace('.', ',')}%`, sx + 390, y + 28);
  });
  if (d.top.length) {
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.font = `600 16px ${SANS}`;
    const line = `Больше всех играли: ${d.top.slice(0, 3).map((p) => `${p.name} (${Math.round(p.hours)} ч)`).join(', ')}`;
    let t = line;
    while (t.length > 10 && ctx.measureText(t).width > 504) t = t.slice(0, -1);
    ctx.fillText(t === line ? t : `${t}…`, sx, by + 22 + Math.min(5, d.servers.length) * 50 + 22);
  }
  return canvas.toBuffer('png');
}

// ---------- the message ----------
const sign = (to: number) => crypto.createHmac('sha256', JWT_SECRET).update(`digest:${to}`).digest('hex').slice(0, 20);

export function digestMessage(d: Digest) {
  const base = publicBase();
  const t = d.totals;
  const lines = [
    `👥 **${t.players}** ${t.players === 1 ? 'игрок' : 'игроков'}${deltaText(delta(t.players, t.prevPlayers))}, из них новых **${t.newPlayers}**`,
    `🔥 Пик онлайна **${t.peak}**${t.peakServer ? ` на ${t.peakServer}` : ''}`,
    `⏱️ **${t.hours.toLocaleString('ru-RU')}** часов в игре${deltaText(delta(t.hours, t.prevHours))}`,
    `🟢 Доступность **${t.uptime == null ? '–' : `${String(t.uptime).replace('.', ',')}%`}**${t.incidents ? `, сбоев: ${t.incidents}` : ', без сбоев'}`,
  ];
  if (d.top.length) lines.push(`🏆 Больше всех играли: ${d.top.slice(0, 3).map((p) => `**${p.name}** (${Math.round(p.hours)} ч)`).join(', ')}`);
  return {
    content: '',
    mention: 'none' as const,
    // below the picture: a button to the full numbers on the site
    ...(base ? { actions: [{ label: '📈 Подробности на сайте', url: `${base}/status` }] } : {}),
    embed: {
      title: `📊 Неделя на ${brand().name}: ${dateRu(d.from)} – ${dateRu(d.to)}`,
      description: lines.join('\n'),
      color: 0x5865f2,
      ...(base ? { url: `${base}/status`, image: { url: `${base}/api/digest/${d.to}-${sign(d.to)}.png` } } : {}),
      footer: { text: 'CoreGSM · итоги недели' },
      timestamp: new Date(d.to).toISOString(),
    },
  };
}

export function sendDigest(now = Date.now()): boolean {
  const s = digestSettings();
  const channel = s.channelId || alertSettings().channelId;
  if (!channel) return false;
  enqueueAlert('digest', 'Итоги недели', digestMessage(buildDigest(now)), channel);
  setSetting('digest_last_sent', String(now));
  return true;
}

/** once every 10 minutes: is it the chosen weekday and hour, and has this week's digest not gone out yet? */
export function digestDue(now = Date.now()): boolean {
  const s = digestSettings();
  if (!s.enabled) return false;
  const p = localParts(now, tz());
  return p.dow === s.weekday && p.hour === s.hour && now - s.lastSent > 2 * DAY;
}

let timer: NodeJS.Timeout | undefined;
export function startDigestTimer(): void {
  timer = setInterval(() => {
    try {
      if (digestDue()) sendDigest();
    } catch (e) {
      console.error('weekly digest failed:', (e as Error).message);
    }
  }, 10 * 60_000);
  timer.unref();
}

export function registerDigest({ app, admin }: { app: Express; admin: RequestHandler }): void {
  const payload = () => ({ ...digestSettings(), preview: buildDigest() });

  app.get('/api/digest', admin, (_req, res) => res.json(payload()));

  app.put('/api/digest', admin, (req, res) => {
    const b = z
      .object({
        enabled: z.boolean().optional(),
        channelId: z.string().regex(/^(\d{15,25})?$/).optional(),
        weekday: z.number().int().min(0).max(6).optional(),
        hour: z.number().int().min(0).max(23).optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    if (b.data.enabled && !(b.data.channelId ?? (digestSettings().channelId || alertSettings().channelId))) {
      return res.status(400).json({ error: 'Сначала выберите канал для оповещений' });
    }
    if (b.data.enabled !== undefined) setSetting('digest_enabled', b.data.enabled ? '1' : '0');
    if (b.data.channelId !== undefined) setSetting('digest_channel', b.data.channelId);
    if (b.data.weekday !== undefined) setSetting('digest_weekday', String(b.data.weekday));
    if (b.data.hour !== undefined) setSetting('digest_hour', String(b.data.hour));
    res.json(payload());
  });

  app.post('/api/digest/send', admin, (_req, res) => {
    if (!sendDigest()) return res.status(400).json({ error: 'Сначала выберите канал для оповещений' });
    res.json(payload());
  });

  // the picture of a digest: the administrator's preview, or the signed address in the Discord message
  app.get('/api/digest/preview.png', admin, async (_req, res, next) => {
    try {
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).send(await renderDigest(buildDigest()));
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/digest/:to-:sig.png', param('to'), param('sig', /^[0-9a-f]{20}$/), async (req, res, next) => {
    const to = Number(req.params.to);
    if (req.params.sig !== sign(to) || to > Date.now() + 60_000) return res.status(404).json({ error: 'Не найдено' });
    try {
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800, immutable' }).send(await renderDigest(buildDigest(to)));
    } catch (e) {
      next(e);
    }
  });
}
