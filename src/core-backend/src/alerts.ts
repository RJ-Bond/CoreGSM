/**
 * Alerts: a message to an administrators' Discord channel when a game server stops answering
 * (after a grace period) and another one when it is back. The bot delivers the queued messages.
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { db, EFFECTIVE_NAME, getSetting, setSetting } from './db.js';
import { gameLabel } from './games.js';
import { inMaintenance } from './maintenance.js';
import { claimDue, enqueueDelivery, registerKind, reportResult } from './deliveries.js';

db.exec(`
CREATE TABLE IF NOT EXISTS alert_state (
  server_id INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  down_since INTEGER NOT NULL,
  alerted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  server_name TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER
);
`);

const settings = () => ({
  enabled: getSetting('alerts_enabled') === '1',
  channelId: getSetting('alerts_channel') ?? '',
  afterMin: Math.min(120, Math.max(1, Number(getSetting('alerts_after_min')) || 3)),
  mention: (['none', 'here', 'everyone'].includes(getSetting('alerts_mention') ?? '') ? getSetting('alerts_mention') : 'none') as 'none' | 'here' | 'everyone',
});

const COLOR = { down: 0xf23f42, up: 0x23a55a, test: 0x5865f2 };

interface Payload {
  content: string;
  mention: 'none' | 'here' | 'everyone';
  embed: Record<string, unknown>;
}

function enqueue(kind: 'down' | 'up' | 'test', serverName: string, payload: Payload) {
  const s = settings();
  const now = Date.now();
  // the alerts table is the history shown in the panel; the delivery (attempts, backoff) lives in `deliveries`
  const r = db.prepare('INSERT INTO alerts (kind, server_name, channel_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(kind, serverName, s.channelId, JSON.stringify(payload), now, now);
  enqueueDelivery({ kind: 'alert', refId: Number(r.lastInsertRowid), target: s.channelId, payload });
  db.prepare('DELETE FROM alerts WHERE created_at < ?').run(now - 14 * 24 * 3600 * 1000);
}

// the delivery queue reports its progress back into the history rows
registerKind('alert', {
  onState(refId, status, error, now) {
    // a failed attempt with a retry scheduled stays "queued" (with the last error); only a dead delivery is an error
    const st = status === 'sent' ? 'sent' : status === 'dead' ? 'error' : status === 'sending' ? 'sending' : 'queued';
    db.prepare("UPDATE alerts SET status = ?, error = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, updated_at = ? WHERE id = ?").run(st, error, st, now, now, refId);
  },
});

// alerts queued by an older version (before the delivery queue existed) are moved into it once
for (const a of db.prepare("SELECT id, channel_id, payload FROM alerts WHERE status IN ('queued','sending')").all() as { id: number; channel_id: string; payload: string }[]) {
  if (!db.prepare("SELECT 1 FROM deliveries WHERE kind = 'alert' AND ref_id = ?").get(a.id)) {
    enqueueDelivery({ kind: 'alert', refId: a.id, target: a.channel_id, payload: JSON.parse(a.payload) as unknown });
  }
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));
const human = (min: number) => (min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч ${min % 60} мин`);

/** Called after every poll of a server. */
export function trackAlerts(serverId: number, online: boolean, error: string | null): void {
  const s = settings();
  if (!s.enabled || !s.channelId) {
    db.prepare('DELETE FROM alert_state WHERE server_id = ?').run(serverId);
    return;
  }
  const now = Date.now();
  const st = db.prepare('SELECT down_since, alerted FROM alert_state WHERE server_id = ?').get(serverId) as { down_since: number; alerted: number } | undefined;
  const info = () =>
    db
      .prepare(`SELECT ${EFFECTIVE_NAME} AS n, s.game, s.display_address, s.host, s.port FROM servers s LEFT JOIN status st ON st.server_id = s.id WHERE s.id = ?`)
      .get(serverId) as { n: string; game: string; display_address: string; host: string; port: number } | undefined;

  // maintenance window: nothing is sent. A not yet alerted outage is forgotten, so that a real outage that is still
  // going on when the window ends starts counting from the end of the window; an already alerted one stays as it is.
  if (inMaintenance(serverId, now)) {
    if (st && !st.alerted) db.prepare('DELETE FROM alert_state WHERE server_id = ?').run(serverId);
    return;
  }

  if (online) {
    if (st) {
      db.prepare('DELETE FROM alert_state WHERE server_id = ?').run(serverId);
      if (st.alerted) {
        const i = info();
        if (i) {
          enqueue('up', i.n, {
            content: '',
            mention: 'none',
            embed: {
              title: `🟢 ${i.n} снова в сети`,
              description: `📍 \`${i.display_address || `${i.host}:${i.port}`}\`\nПростой: **${human(minutes(now - st.down_since))}**`,
              color: COLOR.up,
              author: { name: `🎮 ${gameLabel(i.game)}` },
              footer: { text: 'CoreGSM · оповещение' },
              timestamp: new Date(now).toISOString(),
            },
          });
        }
      }
    }
    return;
  }

  if (!st) {
    db.prepare('INSERT INTO alert_state (server_id, down_since, alerted) VALUES (?, ?, 0)').run(serverId, now);
    return;
  }
  if (!st.alerted && now - st.down_since >= s.afterMin * 60_000) {
    const i = info();
    db.prepare('UPDATE alert_state SET alerted = 1 WHERE server_id = ?').run(serverId);
    if (!i) return;
    enqueue('down', i.n, {
      content: s.mention === 'everyone' ? '@everyone' : s.mention === 'here' ? '@here' : '',
      mention: s.mention,
      embed: {
        title: `🔴 ${i.n} недоступен`,
        description: `📍 \`${i.display_address || `${i.host}:${i.port}`}\`\nСервер не отвечает уже **${human(minutes(now - st.down_since))}**${error ? `\n⚠️ ${error.slice(0, 300)}` : ''}`,
        color: COLOR.down,
        author: { name: `🎮 ${gameLabel(i.game)}` },
        footer: { text: 'CoreGSM · оповещение' },
        timestamp: new Date(now).toISOString(),
      },
    });
  }
}

export function registerAlerts(deps: {
  app: Express;
  admin: RequestHandler;
  internal: RequestHandler;
  channelInfo: (id: string) => { channelName: string | null; guildName: string | null };
}): void {
  const { app, admin, internal, channelInfo } = deps;

  const payload = () => {
    const s = settings();
    const ch = s.channelId ? channelInfo(s.channelId) : { channelName: null, guildName: null };
    const recent = db.prepare('SELECT id, kind, server_name, status, error, created_at, sent_at FROM alerts ORDER BY id DESC LIMIT 30').all() as {
      id: number;
      kind: string;
      server_name: string;
      status: string;
      error: string | null;
      created_at: number;
      sent_at: number | null;
    }[];
    return {
      ...s,
      channelName: ch.channelName,
      guildName: ch.guildName,
      recent: recent.map((r) => ({ id: r.id, kind: r.kind, serverName: r.server_name, status: r.status, error: r.error, createdAt: r.created_at, sentAt: r.sent_at })),
    };
  };

  app.get('/api/alerts', admin, (_req, res) => res.json(payload()));

  app.put('/api/alerts', admin, (req, res) => {
    const b = z
      .object({
        enabled: z.boolean().optional(),
        channelId: z.string().regex(/^(\d{15,25})?$/, 'Неверный ID канала').optional(),
        afterMin: z.number().int().min(1).max(120).optional(),
        mention: z.enum(['none', 'here', 'everyone']).optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля' });
    if (b.data.enabled !== undefined) {
      if (b.data.enabled && !(b.data.channelId ?? getSetting('alerts_channel'))) return res.status(400).json({ error: 'Сначала выберите канал для оповещений' });
      setSetting('alerts_enabled', b.data.enabled ? '1' : '0');
    }
    if (b.data.channelId !== undefined) setSetting('alerts_channel', b.data.channelId);
    if (b.data.afterMin !== undefined) setSetting('alerts_after_min', String(b.data.afterMin));
    if (b.data.mention !== undefined) setSetting('alerts_mention', b.data.mention);
    res.json(payload());
  });

  app.post('/api/alerts/test', admin, (_req, res) => {
    const s = settings();
    if (!s.channelId) return res.status(400).json({ error: 'Сначала выберите канал для оповещений' });
    enqueue('test', 'Проверка', {
      content: '',
      mention: 'none',
      embed: {
        title: '🔔 Проверка оповещений',
        description: 'Если вы видите это сообщение, оповещения о недоступности серверов настроены верно.',
        color: COLOR.test,
        footer: { text: 'CoreGSM · оповещение' },
        timestamp: new Date().toISOString(),
      },
    });
    res.json(payload());
  });

  // ----- the bot (compatibility shim: the bot now uses /internal/deliveries/*; ids here are delivery ids) -----
  app.get('/internal/alerts/pending', internal, (_req, res) => {
    res.json(claimDue(['alert']).map((d) => ({ id: d.id, channelId: d.target, payload: d.payload as Payload })));
  });

  app.patch('/internal/alerts/:id', internal, (req, res) => {
    const b = z.object({ status: z.enum(['sent', 'error']), error: z.string().max(300).nullable().optional() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad body' });
    reportResult(Number(req.params.id), b.data.status === 'sent' ? { ok: true } : { ok: false, error: b.data.error ?? 'Ошибка отправки' });
    res.json({ ok: true });
  });
}
