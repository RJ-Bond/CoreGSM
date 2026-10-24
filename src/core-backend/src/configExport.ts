/**
 * The panel's setup as one JSON file, to move it to another panel in a minute (or keep a readable copy).
 * Unlike a backup it holds no players, history or accounts, and no secrets (bot token, passwords, keys):
 * servers, Discord status messages, alert and digest settings, appearance, maintenance that repeats,
 * scheduled restarts, autoroles and counters.
 *
 *   GET  /api/config/export             the file
 *   POST /api/config/import?dry=1       what an import would change, without changing anything
 *   POST /api/config/import             import: a server with the same game, address and port is updated,
 *                                       others are added; the settings in the file replace the current ones
 */
import express from 'express';
import { z } from 'zod';
import { admin } from './auth.js';
import { db, getSetting, setSetting } from './db.js';

export const router = express.Router();

/** settings that travel with the file: never a secret, never a counter or a timestamp of this panel */
export const PORTABLE_SETTINGS = [
  'alerts_enabled', 'alerts_channel', 'alerts_after_min', 'alerts_mention', 'alerts_smart_low', 'alerts_smart_ping', 'alerts_smart_full',
  'digest_enabled', 'digest_channel', 'digest_weekday', 'digest_hour',
  'brand_name', 'brand_color', 'brand_preset', 'default_theme', 'game_theme',
  'news_channel_id', 'news_test_channel_id', 'embed_players_shown',
  'poll_concurrency', 'poll_fail_threshold', 'timezone',
  'public_panel', 'registration_open', 'registration_mode', 'rules_text',
  'backup_schedule', 'backup_keep',
  'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from',
] as const;

interface ServerRow { id: number; name: string; game: string; host: string; port: number; query_port: number | null; display_address: string; country: string }

export function exportConfig() {
  const servers = db.prepare('SELECT id, name, game, host, port, query_port, display_address, country FROM servers ORDER BY id').all() as ServerRow[];
  const ref = new Map(servers.map((s, i) => [s.id, i]));
  const settings: Record<string, string> = {};
  for (const k of PORTABLE_SETTINGS) {
    const v = getSetting(k);
    if (v !== null) settings[k] = v;
  }
  const opt = <T,>(sql: string): T[] => {
    try {
      return db.prepare(sql).all() as T[];
    } catch {
      return [];
    }
  };
  return {
    app: 'coregsm',
    format: 1,
    exportedAt: new Date().toISOString(),
    servers: servers.map((s) => ({ name: s.name, game: s.game, host: s.host, port: s.port, queryPort: s.query_port, displayAddress: s.display_address, country: s.country })),
    bindings: opt<{ server_id: number; channel_id: string; interval_sec: number; enabled: number; style: string; extra_ids: string }>('SELECT server_id, channel_id, interval_sec, enabled, style, extra_ids FROM bindings')
      .filter((b) => ref.has(b.server_id))
      .map((b) => ({ server: ref.get(b.server_id)!, channelId: b.channel_id, intervalSec: b.interval_sec, enabled: !!b.enabled, style: b.style, extra: (JSON.parse(b.extra_ids || '[]') as number[]).filter((id) => ref.has(id)).map((id) => ref.get(id)!) })),
    maintenance: opt<{ server_id: number | null; name: string; start_ts: number; end_ts: number; repeat: string }>("SELECT server_id, name, start_ts, end_ts, repeat FROM maintenance_windows WHERE repeat != 'none'")
      .filter((w) => w.server_id === null || ref.has(w.server_id))
      .map((w) => ({ server: w.server_id === null ? null : ref.get(w.server_id)!, name: w.name, startTs: w.start_ts, endTs: w.end_ts, repeat: w.repeat })),
    restarts: opt<{ server_id: number; enabled: number; days: number; at_min: number; duration_min: number; warn_min: number; channel_id: string; command: string; say: string }>('SELECT * FROM restart_plans')
      .filter((p) => ref.has(p.server_id))
      .map((p) => ({ server: ref.get(p.server_id)!, enabled: !!p.enabled, days: p.days, atMin: p.at_min, durationMin: p.duration_min, warnMin: p.warn_min, channelId: p.channel_id, command: p.command, say: p.say })),
    autoroles: opt<{ guild_id: string; role_id: string; kind: string; threshold: number; server_id: number | null }>('SELECT guild_id, role_id, kind, threshold, server_id FROM autoroles')
      .map((r) => ({ guildId: r.guild_id, roleId: r.role_id, kind: r.kind, threshold: r.threshold, server: r.server_id === null ? null : ref.get(r.server_id) ?? null })),
    counters: opt<{ channel_id: string; template: string; server_id: number | null }>('SELECT channel_id, template, server_id FROM voice_counters')
      .map((c) => ({ channelId: c.channel_id, template: c.template, server: c.server_id === null ? null : ref.get(c.server_id) ?? null })),
    settings,
  };
}

const snow = z.string().regex(/^\d{15,25}$/);
const serverRef = z.number().int().min(0).max(999);
const fileSchema = z.object({
  app: z.literal('coregsm'),
  format: z.literal(1),
  servers: z.array(z.object({ name: z.string().min(1).max(100), game: z.string().min(1).max(40), host: z.string().min(1).max(253), port: z.number().int().min(1).max(65535), queryPort: z.number().int().min(1).max(65535).nullable().optional(), displayAddress: z.string().max(200).optional(), country: z.string().max(8).optional() })).max(500),
  bindings: z.array(z.object({ server: serverRef, channelId: snow, intervalSec: z.number().int().min(30).max(3600), enabled: z.boolean(), style: z.enum(['embed', 'card', 'both']), extra: z.array(serverRef).max(9) })).max(500).default([]),
  maintenance: z.array(z.object({ server: serverRef.nullable(), name: z.string().max(100), startTs: z.number().int(), endTs: z.number().int(), repeat: z.enum(['daily', 'weekly']) })).max(200).default([]),
  restarts: z.array(z.object({ server: serverRef, enabled: z.boolean(), days: z.number().int().min(0).max(127), atMin: z.number().int().min(0).max(1439), durationMin: z.number().int().min(1).max(240), warnMin: z.number().int().min(0).max(120), channelId: z.string().regex(/^(\d{15,25})?$/), command: z.string().max(200), say: z.string().max(200) })).max(500).default([]),
  autoroles: z.array(z.object({ guildId: snow, roleId: snow, kind: z.enum(['online', 'week_top', 'hours']), threshold: z.number().int().min(0).max(10000), server: serverRef.nullable() })).max(100).default([]),
  counters: z.array(z.object({ channelId: snow, template: z.string().min(1).max(100), server: serverRef.nullable() })).max(50).default([]),
  settings: z.record(z.string(), z.string().max(5000)).default({}),
});
export type ConfigFile = z.infer<typeof fileSchema>;

/** applies (or, with dry, only counts) an import; the answer says what changed */
export function importConfig(file: ConfigFile, dry: boolean) {
  const sum = { serversAdded: 0, serversUpdated: 0, bindings: 0, maintenance: 0, restarts: 0, autoroles: 0, counters: 0, settings: 0 };
  const apply = () => {
    const ids: number[] = [];
    const find = db.prepare('SELECT id FROM servers WHERE game = ? AND lower(host) = lower(?) AND port = ?');
    for (const s of file.servers) {
      const hit = find.get(s.game, s.host, s.port) as { id: number } | undefined;
      if (hit) {
        sum.serversUpdated++;
        db.prepare('UPDATE servers SET name = ?, query_port = ?, display_address = ?, country = ? WHERE id = ?').run(s.name, s.queryPort ?? null, s.displayAddress ?? '', s.country ?? '', hit.id);
        ids.push(hit.id);
      } else {
        sum.serversAdded++;
        ids.push(Number(db.prepare('INSERT INTO servers (name, game, host, port, query_port, display_address, country, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(s.name, s.game, s.host, s.port, s.queryPort ?? null, s.displayAddress ?? '', s.country ?? '', Date.now()).lastInsertRowid));
      }
    }
    const idOf = (i: number | null) => (i === null ? null : ids[i] ?? undefined);
    for (const b of file.bindings) {
      const sid = idOf(b.server);
      if (!sid) continue;
      // the same server in the same channel: already there
      if (db.prepare('SELECT 1 FROM bindings WHERE server_id = ? AND channel_id = ?').get(sid, b.channelId)) continue;
      sum.bindings++;
      db.prepare('INSERT INTO bindings (server_id, channel_id, interval_sec, enabled, style, extra_ids) VALUES (?, ?, ?, ?, ?, ?)').run(sid, b.channelId, b.intervalSec, b.enabled ? 1 : 0, b.style, JSON.stringify(b.extra.map((i) => ids[i]).filter(Boolean)));
    }
    for (const w of file.maintenance) {
      const sid = idOf(w.server);
      if (sid === undefined) continue;
      if (db.prepare('SELECT 1 FROM maintenance_windows WHERE server_id IS ? AND name = ? AND start_ts = ? AND repeat = ?').get(sid, w.name, w.startTs, w.repeat)) continue;
      sum.maintenance++;
      db.prepare('INSERT INTO maintenance_windows (server_id, name, start_ts, end_ts, repeat, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(sid, w.name, w.startTs, w.endTs, w.repeat, 'импорт', Date.now());
    }
    for (const p of file.restarts) {
      const sid = idOf(p.server);
      if (!sid) continue;
      sum.restarts++;
      db.prepare(
        `INSERT INTO restart_plans (server_id, enabled, days, at_min, duration_min, warn_min, channel_id, command, say) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id) DO UPDATE SET enabled = excluded.enabled, days = excluded.days, at_min = excluded.at_min, duration_min = excluded.duration_min,
           warn_min = excluded.warn_min, channel_id = excluded.channel_id, command = excluded.command, say = excluded.say`,
      ).run(sid, p.enabled ? 1 : 0, p.days, p.atMin, p.durationMin, p.warnMin, p.channelId, p.command, p.say);
    }
    for (const r of file.autoroles) {
      const sid = idOf(r.server);
      if (sid === undefined) continue;
      if (db.prepare('SELECT 1 FROM autoroles WHERE guild_id = ? AND role_id = ? AND kind = ? AND server_id IS ?').get(r.guildId, r.roleId, r.kind, sid)) continue;
      sum.autoroles++;
      db.prepare('INSERT INTO autoroles (guild_id, role_id, kind, threshold, server_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(r.guildId, r.roleId, r.kind, r.threshold, sid, Date.now());
    }
    for (const c of file.counters) {
      const sid = idOf(c.server);
      if (sid === undefined) continue;
      if (db.prepare('SELECT 1 FROM voice_counters WHERE channel_id = ?').get(c.channelId)) continue;
      sum.counters++;
      db.prepare('INSERT INTO voice_counters (channel_id, template, server_id, created_at) VALUES (?, ?, ?, ?)').run(c.channelId, c.template, sid, Date.now());
    }
    for (const [k, v] of Object.entries(file.settings)) {
      if (!(PORTABLE_SETTINGS as readonly string[]).includes(k)) continue;
      if (getSetting(k) === v) continue;
      sum.settings++;
      setSetting(k, v);
    }
    // a dry run counts inside a transaction that is rolled back
    if (dry) throw new DryRun();
  };
  try {
    db.transaction(apply)();
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return sum;
}
class DryRun extends Error {}

router.get('/api/config/export', admin, (_req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  res.set({ 'Content-Disposition': `attachment; filename="coregsm-config-${day}.json"` }).json(exportConfig());
});

router.post('/api/config/import', admin, (req, res) => {
  const b = fileSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Это не файл настроек CoreGSM или он повреждён' });
  res.json({ dry: req.query.dry === '1', ...importConfig(b.data, req.query.dry === '1') });
});
