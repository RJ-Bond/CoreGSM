/**
 * GET /api/metrics: the state of the panel in the Prometheus text format (version 0.0.4), for Grafana and alerting.
 * Off (404) until METRICS_TOKEN is set in .env; then it needs `Authorization: Bearer <METRICS_TOKEN>`.
 */
import type { Express } from 'express';
import { APP_VERSION } from './config.js';
import { db } from './db.js';
import { sampleNow } from './health.js';
import { safeEqual } from './http.js';

const esc = (v: string): string => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const labels = (l: Record<string, string | number>): string => {
  const parts = Object.entries(l).map(([k, v]) => `${k}="${esc(String(v))}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
};

interface Row { id: number; name: string; game: string; online: number | null; players: number | null; max_players: number | null; ping: number | null; updated_at: number | null }

/** the whole answer as text (kept apart from the route so it can be tested) */
export function renderMetrics(now = Date.now()): string {
  const out: string[] = [];
  const metric = (name: string, help: string, type: 'gauge' | 'counter', samples: { l?: Record<string, string | number>; v: number }[]) => {
    if (!samples.length) return;
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const s of samples) out.push(`${name}${labels(s.l ?? {})} ${Number.isFinite(s.v) ? s.v : 0}`);
  };

  const s = sampleNow(now);
  const rows = db
    .prepare('SELECT s.id, s.name, s.game, st.online, st.players, st.max_players, st.ping, st.updated_at FROM servers s LEFT JOIN status st ON st.server_id = s.id ORDER BY s.id')
    .all() as Row[];

  metric('coregsm_info', 'Build information (always 1)', 'gauge', [{ l: { version: APP_VERSION || 'dev' }, v: 1 }]);
  metric('coregsm_uptime_seconds', 'Seconds since the backend started', 'gauge', [{ v: Math.round(process.uptime()) }]);
  metric('coregsm_servers', 'Servers on the panel', 'gauge', [{ v: rows.length }]);
  metric('coregsm_servers_online', 'Servers that answered the last poll', 'gauge', [{ v: rows.filter((r) => r.online).length }]);
  metric('coregsm_players_total', 'Players online across all servers', 'gauge', [{ v: rows.reduce((a, r) => a + (r.online ? r.players ?? 0 : 0), 0) }]);

  metric('coregsm_server_online', '1 when the server answered the last poll', 'gauge', rows.map((r) => ({ l: { id: r.id, name: r.name, game: r.game }, v: r.online ? 1 : 0 })));
  metric('coregsm_server_players', 'Players on the server', 'gauge', rows.map((r) => ({ l: { id: r.id, name: r.name, game: r.game }, v: r.online ? r.players ?? 0 : 0 })));
  metric('coregsm_server_max_players', 'Player slots of the server', 'gauge', rows.map((r) => ({ l: { id: r.id, name: r.name, game: r.game }, v: r.max_players ?? 0 })));
  metric('coregsm_server_ping_ms', 'Ping of the last successful poll', 'gauge', rows.filter((r) => r.online && r.ping != null).map((r) => ({ l: { id: r.id, name: r.name, game: r.game }, v: r.ping! })));
  metric('coregsm_server_last_poll_timestamp_seconds', 'When the server was last polled', 'gauge', rows.filter((r) => r.updated_at).map((r) => ({ l: { id: r.id, name: r.name, game: r.game }, v: Math.round(r.updated_at! / 1000) })));

  metric('coregsm_poll_duration_ms', 'Duration of the last polling round', 'gauge', [{ v: s.pollMs }]);
  metric('coregsm_poll_failures', 'Servers that failed in the last polling round', 'gauge', [{ v: s.pollFailures }]);
  metric('coregsm_queue_length', 'Messages waiting for the Discord bot', 'gauge', [{ v: s.queueLen }]);
  metric('coregsm_bot_up', '1 when the Discord bot reports a healthy state', 'gauge', [{ v: s.botState === 'ready' || s.botState === 'online' ? 1 : 0 }]);
  metric('coregsm_bot_state', 'State of the Discord bot (the label carries it)', 'gauge', [{ l: { state: s.botState }, v: 1 }]);
  metric('coregsm_db_bytes', 'Size of the SQLite database', 'gauge', [{ v: s.dbBytes }]);
  metric('coregsm_memory_rss_bytes', 'Resident memory of the backend', 'gauge', [{ v: s.rssMb * 1048576 }]);
  if (s.diskFree != null) metric('coregsm_disk_free_bytes', 'Free space where the data lives', 'gauge', [{ v: s.diskFree }]);

  return out.join('\n') + '\n';
}

export function registerMetrics(app: Express): void {
  app.get('/api/metrics', (req, res) => {
    const token = process.env.METRICS_TOKEN ?? '';
    // not configured: the route does not exist (nothing to probe)
    if (token.length < 16) return res.status(404).json({ error: 'Не найдено' });
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''));
    if (!m || !safeEqual(m[1], token)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: 'Требуется вход' });
    }
    res.type('text/plain; version=0.0.4; charset=utf-8').send(renderMetrics());
  });
}
