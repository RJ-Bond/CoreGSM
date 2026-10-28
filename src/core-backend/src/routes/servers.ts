/** Game servers: list and CRUD, server page data, history, PNG card, share page, status page. */
import express from 'express';
import { z } from 'zod';
import { admin, allow, isAdmin, loadUser, publicPanel, userFromToken, viewer } from '../auth.js';
import { channelInfo } from '../botState.js';
import { isKnownGame, renderAllCard, renderCard, renderGameIcon } from '../card.js';
import { parseCardOpts } from '../cardLogic.js';
import { removeCover } from '../covers.js';
import { type BindingRow, db, type ServerRow } from '../db.js';
import { gameLabel } from '../games.js';
import { countryOf } from '../geo.js';
import { queryServer, refreshServer, retentionDays } from '../gsm.js';
import { param, wrap } from '../http.js';
import { occurrencesBetween, type WindowRow } from '../maintenance.js';
import { vrRankIdFor } from '../profile.js';
import { downtimeByDay, incidentsSince } from '../incidents.js';
import { completeOrder } from '../serverOrderLogic.js';
import { getServer, publicServer, SELECT_SERVERS, SERVER_ORDER, serialize, type ServerJoin } from '../serverData.js';
import { baseOf, brand, publicBase } from '../site.js';
import { publicNotes } from '../statusNotes.js';

export const router = express.Router();

// a pinned note of the staff on the overview of a server (rules, the next wipe, working hours)
db.exec(`
CREATE TABLE IF NOT EXISTS server_notices (
  server_id INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'info',
  updated_at INTEGER NOT NULL
);
`);
const NOTICE_TONES = ['info', 'ok', 'warn', 'bad'] as const;

// ---------- servers ----------
const serverSchema = z.object({
  // optional: when empty the title is taken from the game server's own reply
  name: z.string().trim().max(64).optional(),
  game: z.string().trim().min(1).max(32).regex(/^[a-z0-9_]+$/i),
  host: z.string().trim().min(1).max(255).regex(/^[a-z0-9.\-:]+$/i),
  port: z.number().int().min(1).max(65535),
  queryPort: z.number().int().min(1).max(65535).nullable().optional(),
  // what people see instead of host:port, e.g. a public IP or domain (the panel still queries `host`)
  displayAddress: z
    .string()
    .trim()
    .max(100)
    .regex(/^[^\s<>"']*$/, 'Адрес для отображения не должен содержать пробелов и кавычек')
    .optional(),
  // two-letter country code shown in the Discord message; empty = detect from the address
  country: z.string().trim().regex(/^([A-Za-z]{2})?$/, 'Страна: двухбуквенный код').optional(),
});

router.get('/api/servers', viewer, (req, res) => {
  const rows = db.prepare(`${SELECT_SERVERS} ORDER BY ${SERVER_ORDER}`).all() as ServerJoin[];
  const list = rows.map(serialize);
  res.json(isAdmin(req) ? list : list.map(publicServer));
});

/**
 * The sparklines of the server list (and the comparison chart) in one request: for every server the player count
 * over the last `hours` (up to 14 days), cut into `points` buckets (48 by default, the busiest moment of each),
 * and which buckets had the server down. An empty bucket (no poll in it) is null.
 */
router.get('/api/servers/sparks', viewer, (req, res) => {
  const hours = Math.min(336, Math.max(1, Number(req.query.hours) || 24));
  const SPARK_POINTS = Math.min(200, Math.max(12, Number(req.query.points) || 48));
  const now = Date.now();
  const since = now - hours * 3600_000;
  const bucket = Math.ceil((hours * 3600_000) / SPARK_POINTS);
  const rows = db
    .prepare(
      `SELECT server_id AS id, MIN(CAST((ts - ?) / ? AS INTEGER), ${SPARK_POINTS - 1}) AS b, MAX(players) AS p, MIN(online) AS o
       FROM history WHERE ts > ? GROUP BY server_id, b`,
    )
    .all(since, bucket, since) as { id: number; b: number; p: number; o: number }[];
  const out: Record<number, { players: (number | null)[]; down: boolean[] }> = {};
  for (const r of rows) {
    const s = (out[r.id] ??= { players: Array(SPARK_POINTS).fill(null), down: Array(SPARK_POINTS).fill(false) });
    s.players[r.b] = r.p;
    if (!r.o) s.down[r.b] = true;
  }
  res.set('Cache-Control', 'no-cache').json({ hours, points: SPARK_POINTS, from: since, to: now, servers: out });
});

router.post(
  '/api/servers',
  allow('servers'),
  wrap(async (req, res) => {
    const b = serverSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля формы' });
    const info = db
      .prepare('INSERT INTO servers (name, game, host, port, query_port, display_address, country, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(b.data.name ?? '', b.data.game, b.data.host, b.data.port, b.data.queryPort ?? null, b.data.displayAddress ?? '', (b.data.country ?? '').toUpperCase(), Date.now());
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(info.lastInsertRowid) as ServerRow;
    await refreshServer(row);
    res.status(201).json(getServer(row.id));
  }),
);

// the manual order of the servers (up/down in the admin table); registered before /api/servers/:id
router.put('/api/servers/order', allow('servers'), (req, res) => {
  const b = z.object({ ids: z.array(z.number().int().positive()).max(1000) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Проверьте поля формы' });
  const all = (db.prepare(`SELECT s.id FROM servers s ORDER BY ${SERVER_ORDER}`).all() as { id: number }[]).map((r) => r.id);
  const order = completeOrder(b.data.ids, all);
  const set = db.prepare('UPDATE servers SET sort_order = ? WHERE id = ?');
  db.transaction(() => order.forEach((id, i) => set.run(i + 1, id)))();
  res.json({ ok: true });
});

router.put(
  '/api/servers/:id',
  allow('servers'),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const b = serverSchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля формы' });
    const r = db
      .prepare('UPDATE servers SET name=?, game=?, host=?, port=?, query_port=?, display_address=?, country=? WHERE id=?')
      .run(b.data.name ?? '', b.data.game, b.data.host, b.data.port, b.data.queryPort ?? null, b.data.displayAddress ?? '', (b.data.country ?? '').toUpperCase(), id);
    if (!r.changes) return res.status(404).json({ error: 'Сервер не найден' });
    await refreshServer(db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as ServerRow);
    res.json(getServer(id));
  }),
);

router.delete('/api/servers/:id', admin, (req, res) => {
  const r = db.prepare('DELETE FROM servers WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Сервер не найден' });
  removeCover(Number(req.params.id));
  res.json({ ok: true });
});

// try a server without saving it: used by the "Проверить" button in the add/edit form
router.post(
  '/api/servers/test',
  allow('servers'),
  wrap(async (req, res) => {
    const b = serverSchema.pick({ game: true, host: true, port: true, queryPort: true }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Укажите игру, адрес и порт' });
    const r = await queryServer({
      id: 0,
      name: '',
      display_address: '',
      country: '',
      game: b.data.game,
      host: b.data.host,
      port: b.data.port,
      query_port: b.data.queryPort ?? null,
      created_at: 0,
    });
    res.json(r);
  }),
);

// everything the server page needs: chart points, uptime, peak, outage log
router.get('/api/servers/:id/details', viewer, (req, res) => {
  const id = Number(req.params.id);
  const server = getServer(id);
  if (!server) return res.status(404).json({ error: 'Сервер не найден' });
  // up to 30 days may be asked for; samples are kept for 7 days, so the chart simply shows what exists
  const hours = Math.min(720, Math.max(1, Number(req.query.hours ?? 24)));
  const since = Date.now() - hours * 3600 * 1000;
  const bucketMs = Math.max(30_000, Math.ceil((hours * 3600 * 1000) / 180));

  const points = db
    .prepare(
      `SELECT MIN(ts) AS ts, MAX(players) AS players, MIN(online) AS online,
              CAST(ROUND(AVG(CASE WHEN online = 1 THEN ping END)) AS INTEGER) AS ping
       FROM history WHERE server_id = ? AND ts > ?
       GROUP BY ts / CAST(? AS INTEGER) ORDER BY ts`,
    )
    .all(id, since, bucketMs);
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS samples, AVG(CASE WHEN unconfirmed = 0 AND maint = 0 THEN online END) * 100 AS uptime,
              AVG(CASE WHEN online = 1 THEN players END) AS avg_players
       FROM history WHERE server_id = ? AND ts > ?`,
    )
    .get(id, since) as { samples: number; uptime: number | null; avg_players: number | null };
  const peak = db
    .prepare('SELECT players, ts FROM history WHERE server_id = ? AND ts > ? ORDER BY players DESC, ts DESC LIMIT 1')
    .get(id, since) as { players: number; ts: number } | undefined;
  const events = (
    db
      .prepare(
        `SELECT ts, online FROM (
           SELECT ts, online, LAG(online) OVER (ORDER BY ts) AS prev FROM history WHERE server_id = ? AND ts > ?
         ) WHERE prev IS NOT NULL AND prev <> online ORDER BY ts DESC LIMIT 30`,
      )
      .all(id, since) as { ts: number; online: number }[]
  ).map((e) => ({ ts: e.ts, type: (e.online ? 'up' : 'down') as 'up' | 'down' | 'peak' | 'maintenance', players: null as number | null }));
  // the busiest moment of the period is shown in the event feed as well
  if (peak && peak.players > 0) events.push({ ts: peak.ts, type: 'peak', players: peak.players });
  // planned maintenance (windows of this server and of all servers) starting in the period
  for (const w of db.prepare('SELECT * FROM maintenance_windows WHERE server_id IS NULL OR server_id = ?').all(id) as WindowRow[]) {
    for (const o of occurrencesBetween(w, since, Date.now())) events.push({ ts: o.start, type: 'maintenance', players: null });
  }
  events.sort((a, b) => b.ts - a.ts);

  const isVr = server.game === 'vrising';
  const playersNow = (db.prepare('SELECT name, since FROM player_now WHERE server_id = ? ORDER BY since, name LIMIT 200').all(id) as { name: string; since: number }[]).map((p) => (isVr ? { name: p.name, since: p.since, rankId: vrRankIdFor(p.name) } : { name: p.name, since: p.since }));

  // additive: when the server was added and (admins only) where its Discord message lives
  const createdAt = (db.prepare('SELECT created_at FROM servers WHERE id = ?').get(id) as { created_at: number } | undefined)?.created_at || null;
  const discord = isAdmin(req)
    ? (db.prepare('SELECT * FROM bindings WHERE server_id = ? ORDER BY id').all(id) as BindingRow[]).map((b) => {
        const c = channelInfo(b.channel_id);
        return { channelId: b.channel_id, channelName: c.channelName, guildName: c.guildName, guildId: c.guildId, messageId: b.message_id, enabled: !!b.enabled };
      })
    : [];

  res.json({
    server: { ...(isAdmin(req) ? server : publicServer(server)), countryCode: server.country || countryOf(id, server.host) || '' },
    hours,
    createdAt,
    discord,
    notice: (() => {
      const n = db.prepare('SELECT text, tone, updated_at FROM server_notices WHERE server_id = ?').get(id) as { text: string; tone: string; updated_at: number } | undefined;
      return n ? { text: n.text, tone: n.tone, updatedAt: n.updated_at } : null;
    })(),
    playersNow,
    points,
    stats: {
      samples: agg.samples,
      uptimePct: agg.uptime == null ? null : Math.round(agg.uptime * 10) / 10,
      avgPlayers: agg.avg_players == null ? null : Math.round(agg.avg_players * 10) / 10,
      peakPlayers: peak?.players ?? null,
      peakAt: peak?.ts ?? null,
    },
    events,
    // «обычно»: the average players per hour of the week (UTC weekday * 24 + hour) over the four weeks before the
    // shown period, so the chart can show where today is unusual; null where there is not enough history
    baseline: hours <= 168 ? usualWeek(id, since) : null,
  });
});

router.put('/api/servers/:id/notice', param('id'), allow('servers'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM servers WHERE id = ?').get(id)) return res.status(404).json({ error: 'Сервер не найден' });
  const b = z.object({ text: z.string().trim().max(500), tone: z.enum(NOTICE_TONES).default('info') }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Текст объявления — до 500 символов' });
  if (!b.data.text) {
    db.prepare('DELETE FROM server_notices WHERE server_id = ?').run(id);
    return res.json({ notice: null });
  }
  const now = Date.now();
  db.prepare('INSERT INTO server_notices (server_id, text, tone, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(server_id) DO UPDATE SET text = excluded.text, tone = excluded.tone, updated_at = excluded.updated_at').run(id, b.data.text, b.data.tone, now);
  res.json({ notice: { text: b.data.text, tone: b.data.tone, updatedAt: now } });
});

function usualWeek(serverId: number, before: number): (number | null)[] {
  const out = Array<number | null>(168).fill(null);
  const rows = db
    .prepare(
      `SELECT CAST(strftime('%w', ts / 1000, 'unixepoch') AS INTEGER) * 24 + CAST(strftime('%H', ts / 1000, 'unixepoch') AS INTEGER) AS how,
              AVG(players) AS a, COUNT(DISTINCT ts / 86400000) AS days
       FROM history WHERE server_id = ? AND online = 1 AND ts > ? AND ts < ? GROUP BY how`,
    )
    .all(serverId, before - 28 * 86400_000, before) as { how: number; a: number; days: number }[];
  // at least two different days behind an hour, otherwise one odd evening would be "usual"
  for (const r of rows) if (r.days >= 2) out[r.how] = Math.round(r.a * 10) / 10;
  return out;
}

router.post(
  '/api/servers/:id/refresh',
  allow('servers'),
  wrap(async (req, res) => {
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(Number(req.params.id)) as ServerRow | undefined;
    if (!row) return res.status(404).json({ error: 'Сервер не найден' });
    await refreshServer(row);
    res.json(getServer(row.id));
  }),
);

router.get('/api/servers/:id/history', viewer, (req, res) => {
  const hours = Math.min(168, Math.max(1, Number(req.query.hours ?? 24)));
  const rows = db
    .prepare('SELECT ts, online, players FROM history WHERE server_id = ? AND ts > ? ORDER BY ts')
    .all(Number(req.params.id), Date.now() - hours * 3600 * 1000);
  res.json(rows);
});

// public PNG card (shared links, link previews). A private panel hides it unless the request carries a session token (?t=).
router.get(
  '/api/card/all.png',
  wrap(async (req, res) => {
    if (!publicPanel() && !userFromToken(String(req.query.t ?? '')) && !loadUser(req)) return res.status(404).json({ error: 'Сервер не найден' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }).send(await renderAllCard(parseCardOpts(req.query).theme));
  }),
);
router.get(
  '/api/card/:id.png', param('id'),
  wrap(async (req, res) => {
    if (!publicPanel() && !userFromToken(String(req.query.t ?? '')) && !loadUser(req)) return res.status(404).json({ error: 'Сервер не найден' });
    const buf = await renderCard(Number(req.params.id), parseCardOpts(req.query));
    if (!buf) return res.status(404).json({ error: 'Сервер не найден' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }).send(buf);
  }),
);

// game pictogram for embeds (public: Discord fetches it); unknown ids get the generic icon
router.get(
  '/api/game-icon/:game.png',
  wrap(async (req, res) => {
    const game = String(req.params.game).replace(/[^a-z0-9_]/gi, '');
    // a game the panel does not know still gets its monogram when one of the servers uses it
    const shown = isKnownGame(game) || db.prepare('SELECT 1 FROM servers WHERE game = ?').get(game) ? game : '';
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }).send(await renderGameIcon(shown, req.query.tile === '1'));
  }),
);

// ---------- public server page: a link that looks good when pasted into Discord/Telegram ----------
const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

router.get('/s/:id', param('id'), (req, res) => {
  res.set({ 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' });
  const gone = () =>
    void res
      .status(404)
      .type('html')
      .send('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Не найдено</title></head><body style="font-family:sans-serif;padding:2rem"><h1>Страница недоступна</h1><p><a href="/">На главную</a></p></body></html>');
  if (!publicPanel()) return gone();
  const id = Number(req.params.id);
  const sv = getServer(id);
  if (!sv) return gone();
  const base = publicBase() ?? baseOf(req);
  const b = brand();
  // never the internal host:port; when the server has no title the game name stands in
  const title = sv.name === `${sv.host}:${sv.port}` ? gameLabel(sv.game) : sv.name;
  const parts: string[] = [];
  if (!sv.hasStatus) parts.push('Состояние неизвестно');
  else if (!sv.online) parts.push('Сервер недоступен');
  else {
    parts.push(`Онлайн: ${sv.players}${sv.maxPlayers ? `/${sv.maxPlayers}` : ''}`);
    if (sv.map) parts.push(`Карта: ${sv.map}`);
  }
  parts.push(`Игра: ${gameLabel(sv.game)}`);
  const desc = parts.join(' · ');
  const target = `/servers/${id}`;
  const url = `${base}/s/${id}`;
  const image = `${base}/api/card/${id}.png`;
  res.type('html').send(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(b.name)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="${esc(b.color)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(b.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="480">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="ru_RU">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<script>location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')});</script>
</head>
<body>
<p><a href="${esc(target)}">${esc(title)}</a></p>
</body>
</html>`);
});

// ---------- status page data ----------
router.get('/api/status', viewer, (req, res) => {
  const rows = db.prepare(`${SELECT_SERVERS} ORDER BY ${SERVER_ORDER}`).all() as ServerJoin[];
  const list = rows.map(serialize);
  const servers = isAdmin(req) ? list : list.map(publicServer);
  const now = Date.now();
  // 30 days by default; ?days=90 shows three months (as far as the uptime history is kept)
  const range = req.query.days === '90' ? Math.min(90, retentionDays().uptime) : 30;
  const days: string[] = [];
  for (let i = range - 1; i >= 0; i--) days.push(new Date(now - i * 86400_000).toISOString().slice(0, 10));
  const daily = new Map<string, { up: number; total: number }>();
  for (const r of db.prepare('SELECT server_id, day, up, total FROM uptime_daily WHERE day >= ?').all(days[0]) as { server_id: number; day: string; up: number; total: number }[]) {
    daily.set(`${r.server_id}|${r.day}`, r);
  }
  const pings = new Map<number, number>();
  for (const r of db.prepare('SELECT server_id, AVG(ping) AS a FROM history WHERE ts > ? AND online = 1 AND ping IS NOT NULL GROUP BY server_id').all(now - 24 * 3600_000) as { server_id: number; a: number }[]) {
    pings.set(r.server_id, Math.round(r.a));
  }
  const pct = (up: number, total: number) => (total > 0 ? Math.round((up / total) * 1000) / 10 : null);
  const last = (db.prepare('SELECT MAX(updated_at) AS t FROM status').get() as { t: number | null }).t;
  // outages of the 30 days: minutes per day for the bars, and the list of incidents under them
  const incidents = incidentsSince(now - range * 86400_000, undefined, now);
  const downtime = downtimeByDay(incidents, now);
  const shown = new Map(servers.map((sv) => [sv.id, sv]));
  // response time: hourly average ping of the last 24 hours
  const latency = new Map<number, (number | null)[]>();
  const hourNow = Math.floor(now / 3600_000);
  for (const r of db
    .prepare('SELECT server_id AS id, ts / 3600000 AS h, AVG(ping) AS a FROM history WHERE ts > ? AND online = 1 AND ping IS NOT NULL GROUP BY id, h')
    .all(now - 24 * 3600_000) as { id: number; h: number; a: number }[]) {
    const arr = latency.get(r.id) ?? Array<number | null>(24).fill(null);
    const i = 23 - (hourNow - r.h);
    if (i >= 0 && i < 24) arr[i] = Math.round(r.a);
    latency.set(r.id, arr);
  }
  res.json({
    updatedAt: last ?? now,
    range,
    // notes of the administrators; a note about a server that is not shown here stays general
    notes: publicNotes(now).map((n) => (n.serverId != null && !shown.has(n.serverId) ? { ...n, serverId: null, serverName: null } : { ...n, serverName: n.serverId != null ? shown.get(n.serverId)!.name : null })),
    incidents: incidents
      .filter((i) => shown.has(i.serverId))
      .reverse()
      .slice(0, 50)
      .map((i) => ({ ...i, serverName: shown.get(i.serverId)!.name, game: shown.get(i.serverId)!.game })),
    servers: servers.map((sv) => {
      let up = 0;
      let total = 0;
      const dd = days.map((day) => {
        const r = daily.get(`${sv.id}|${day}`);
        if (r) {
          up += r.up;
          total += r.total;
        }
        const dt = downtime.get(`${sv.id}|${day}`);
        return { day, pct: r ? pct(r.up, r.total) : null, down: dt ? Math.round(dt.down) : 0, planned: dt ? Math.round(dt.planned) : 0, incidents: dt?.count ?? 0 };
      });
      return {
        id: sv.id,
        name: sv.name,
        game: sv.game,
        address: sv.address,
        coverUrl: sv.coverUrl,
        online: sv.online,
        players: sv.players,
        maxPlayers: sv.maxPlayers,
        uptime30: pct(up, total),
        days: dd,
        avgPing: pings.get(sv.id) ?? null,
        latency: latency.get(sv.id) ?? [],
      };
    }),
  });
});
