/**
 * Checks from other places: probes (probeAgent.ts) running on other machines query the same game servers and
 * report here. A server that the panel cannot reach but a probe can is a network problem between them, not a
 * server that is down; the players see where the server answers from.
 *
 *   GET    /api/probes                 the probes with their last report (administrators)
 *   POST   /api/probes                 add one; the answer holds its token once (administrators)
 *   POST   /api/probes/:id/token       issue a new token, the old one stops working (administrators)
 *   DELETE /api/probes/:id             remove (administrators)
 *   GET    /api/probe/agent.mjs        the probe program
 *   GET    /api/probe/targets          the servers to check (probe token)
 *   POST   /api/probe/results          what the probe saw (probe token)
 *   GET    /api/servers/:id/probes     the view of one server from every probe and from the panel
 */
import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { admin, viewer } from './auth.js';
import { db } from './db.js';
import { AGENT_SOURCE, GAMEDIG_VERSION } from './probeAgent.js';
import { publicBase } from './site.js';

export const router = express.Router();

db.exec(`
CREATE TABLE IF NOT EXISTS probes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  last_ip TEXT,
  version TEXT
);
CREATE TABLE IF NOT EXISTS probe_status (
  probe_id INTEGER NOT NULL REFERENCES probes(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  online INTEGER NOT NULL,
  ping INTEGER,
  players INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (probe_id, server_id)
);
CREATE TABLE IF NOT EXISTS probe_history (
  probe_id INTEGER NOT NULL REFERENCES probes(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  online INTEGER NOT NULL,
  ping INTEGER
);
CREATE INDEX IF NOT EXISTS idx_probe_hist ON probe_history(server_id, ts);
`);

/** a report older than this counts as «no data» */
export const STALE_MS = 5 * 60_000;
const HISTORY_DAYS = 7;

const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const newToken = () => `cgp_${crypto.randomBytes(24).toString('base64url')}`;

interface ProbeRow { id: number; name: string; created_at: number; last_seen: number | null; last_ip: string | null; version: string | null }

function probeFrom(req: express.Request): ProbeRow | null {
  const t = String(req.headers['x-probe-token'] ?? '');
  if (t.length < 20 || t.length > 100) return null;
  return (db.prepare('SELECT id, name, created_at, last_seen, last_ip, version FROM probes WHERE token_hash = ?').get(hash(t)) as ProbeRow | undefined) ?? null;
}

function commands(token: string) {
  const base = publicBase() ?? 'https://ваш-адрес-панели';
  return {
    docker: `docker run -d --name coregsm-probe --restart unless-stopped -e PANEL_URL=${base} -e PROBE_TOKEN=${token} node:22-alpine sh -c "cd /tmp && npm i --silent gamedig@${GAMEDIG_VERSION} && wget -qO probe.mjs ${base}/api/probe/agent.mjs && node probe.mjs"`,
    node: `npm i gamedig@${GAMEDIG_VERSION} && curl -fsSLo probe.mjs ${base}/api/probe/agent.mjs && PANEL_URL=${base} PROBE_TOKEN=${token} node probe.mjs`,
  };
}

// ---------- administrators ----------

router.get('/api/probes', admin, (_req, res) => {
  const now = Date.now();
  const stats = db.prepare('SELECT COUNT(*) AS n, SUM(online) AS up FROM probe_status WHERE probe_id = ? AND updated_at > ?');
  res.json(
    (db.prepare('SELECT id, name, created_at, last_seen, last_ip, version FROM probes ORDER BY id').all() as ProbeRow[]).map((p) => {
      const s = stats.get(p.id, now - STALE_MS) as { n: number; up: number | null };
      return { id: p.id, name: p.name, createdAt: p.created_at, lastSeen: p.last_seen, ip: p.last_ip, version: p.version, alive: !!p.last_seen && now - p.last_seen < STALE_MS, servers: s.n, online: s.up ?? 0 };
    }),
  );
});

router.post('/api/probes', admin, (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(40) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  const token = newToken();
  const id = Number(db.prepare('INSERT INTO probes (name, token_hash, created_at) VALUES (?, ?, ?)').run(b.data.name, hash(token), Date.now()).lastInsertRowid);
  res.json({ id, token, commands: commands(token) });
});

router.post('/api/probes/:id(\\d+)/token', admin, (req, res) => {
  const token = newToken();
  const r = db.prepare('UPDATE probes SET token_hash = ? WHERE id = ?').run(hash(token), Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Не найдено' });
  res.json({ token, commands: commands(token) });
});

router.delete('/api/probes/:id(\\d+)', admin, (req, res) => {
  db.prepare('DELETE FROM probes WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- the probe ----------

router.get('/api/probe/agent.mjs', (_req, res) => {
  res.set({ 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }).send(AGENT_SOURCE);
});

router.get('/api/probe/targets', (req, res) => {
  const p = probeFrom(req);
  if (!p) return res.status(401).json({ error: 'Требуется вход' });
  const rows = db.prepare('SELECT id, game, host, port, query_port FROM servers ORDER BY id').all() as { id: number; game: string; host: string; port: number; query_port: number | null }[];
  res.json(rows.map((r) => ({ id: r.id, game: r.game, host: r.host, port: r.port, queryPort: r.query_port })));
});

router.post('/api/probe/results', (req, res) => {
  const p = probeFrom(req);
  if (!p) return res.status(401).json({ error: 'Требуется вход' });
  const b = z
    .array(z.object({ serverId: z.number().int().positive(), online: z.boolean(), ping: z.number().int().min(0).max(60_000).nullable(), players: z.number().int().min(0).max(100_000).default(0), error: z.string().max(200).nullable().optional() }))
    .max(500)
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  const now = Date.now();
  const known = new Set((db.prepare('SELECT id FROM servers').all() as { id: number }[]).map((r) => r.id));
  db.transaction(() => {
    for (const r of b.data) {
      if (!known.has(r.serverId)) continue;
      db.prepare(
        `INSERT INTO probe_status (probe_id, server_id, online, ping, players, error, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(probe_id, server_id) DO UPDATE SET online = excluded.online, ping = excluded.ping, players = excluded.players, error = excluded.error, updated_at = excluded.updated_at`,
      ).run(p.id, r.serverId, r.online ? 1 : 0, r.ping, r.players, r.online ? null : r.error ?? null, now);
      db.prepare('INSERT INTO probe_history (probe_id, server_id, ts, online, ping) VALUES (?, ?, ?, ?, ?)').run(p.id, r.serverId, now, r.online ? 1 : 0, r.ping);
    }
    db.prepare('UPDATE probes SET last_seen = ?, last_ip = ?, version = ? WHERE id = ?').run(now, (req.ip ?? '').slice(0, 64), String(req.headers['x-probe-version'] ?? '').slice(0, 20) || null, p.id);
    db.prepare('DELETE FROM probe_history WHERE ts < ?').run(now - HISTORY_DAYS * 86_400_000);
  })();
  res.json({ ok: true });
});

// ---------- everybody ----------

/** the server seen from the panel and from every probe: up or down now, ping, availability over 24 hours */
export function probeView(serverId: number, now = Date.now()) {
  const day = now - 86_400_000;
  const panel = db.prepare('SELECT online, ping, updated_at FROM status WHERE server_id = ?').get(serverId) as { online: number; ping: number | null; updated_at: number } | undefined;
  const panelDay = db.prepare('SELECT COUNT(*) AS n, SUM(online) AS up FROM history WHERE server_id = ? AND ts > ?').get(serverId, day) as { n: number; up: number | null };
  const probes = (db
    .prepare(
      `SELECT p.id, p.name, s.online, s.ping, s.updated_at,
         (SELECT COUNT(*) FROM probe_history h WHERE h.probe_id = p.id AND h.server_id = ? AND h.ts > ?) AS n,
         (SELECT SUM(online) FROM probe_history h WHERE h.probe_id = p.id AND h.server_id = ? AND h.ts > ?) AS up
       FROM probes p LEFT JOIN probe_status s ON s.probe_id = p.id AND s.server_id = ? ORDER BY p.id`,
    )
    .all(serverId, day, serverId, day, serverId) as { id: number; name: string; online: number | null; ping: number | null; updated_at: number | null; n: number; up: number | null }[]).map((r) => {
    const fresh = r.updated_at != null && now - r.updated_at < STALE_MS;
    return { name: r.name, online: fresh ? !!r.online : null, ping: fresh ? r.ping : null, updatedAt: r.updated_at, uptime: r.n ? Math.round(((r.up ?? 0) / r.n) * 1000) / 10 : null };
  });
  return {
    panel: { name: 'Панель', online: panel ? !!panel.online : null, ping: panel?.online ? panel.ping : null, updatedAt: panel?.updated_at ?? null, uptime: panelDay.n ? Math.round(((panelDay.up ?? 0) / panelDay.n) * 1000) / 10 : null },
    probes,
  };
}

router.get('/api/servers/:id(\\d+)/probes', viewer, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(id)) return res.status(404).json({ error: 'Сервер не найден' });
  res.json(probeView(id));
});
