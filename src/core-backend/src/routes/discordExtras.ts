/**
 * The bot beyond status messages and news:
 *   autoroles    Discord roles the bot gives and takes away by themselves: «Сейчас в игре», «Игрок недели»,
 *                «Ветеран N ч». Only accounts with a linked Discord and a game nick get them.
 *   counters     voice channels the bot renames into a live counter, «🟢 Онлайн: 42»
 *   commands     data for /online, /status, /player and /top
 *
 * The bot asks GET /internal/discord/sync every tick: for each autorole whom to add and whom to remove (the
 * difference between who should have it and who got it from the bot), and for each counter the name it should
 * have. It reports what it applied, so a role given by hand is never taken away.
 */
import express from 'express';
import { z } from 'zod';
import { admin, internal } from '../auth.js';
import { bot } from '../botState.js';
import { db, EFFECTIVE_NAME } from '../db.js';
import { publicBase } from '../site.js';
import { playerCard, topPlayers } from './community.js';
import { param } from '../http.js';

export const router = express.Router();

const DAY = 86_400_000;

db.exec(`
CREATE TABLE IF NOT EXISTS autoroles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  threshold INTEGER NOT NULL DEFAULT 0,
  server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS autorole_members (
  rule_id INTEGER NOT NULL REFERENCES autoroles(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  PRIMARY KEY (rule_id, discord_id)
);
CREATE TABLE IF NOT EXISTS voice_counters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL UNIQUE,
  template TEXT NOT NULL,
  server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
`);

export const AUTOROLE_KINDS = ['online', 'week_top', 'hours'] as const;
type Kind = (typeof AUTOROLE_KINDS)[number];

interface RuleRow { id: number; guild_id: string; role_id: string; kind: Kind; threshold: number; server_id: number | null; last_error: string | null; created_at: number }
interface CounterRow { id: number; channel_id: string; template: string; server_id: number | null; last_error: string | null; created_at: number }

/** linked accounts: Discord id and game nick (lower case) */
function linked(): { discordId: string; nick: string }[] {
  return (db
    .prepare("SELECT u.discord_id AS d, p.game_nick AS n FROM users u JOIN user_player p ON p.user_id = u.id WHERE u.discord_id IS NOT NULL AND p.game_nick != ''")
    .all() as { d: string; n: string }[]).map((r) => ({ discordId: r.d, nick: r.n.toLowerCase() }));
}

/** the Discord ids that should have the role of a rule right now */
export function wanted(rule: Pick<RuleRow, 'kind' | 'threshold' | 'server_id'>, now = Date.now()): Set<string> {
  const people = linked();
  const srv = rule.server_id ? ' AND server_id = ?' : '';
  const args = rule.server_id ? [rule.server_id] : [];
  let nicks: Set<string>;
  if (rule.kind === 'online') {
    nicks = new Set((db.prepare(`SELECT DISTINCT ulower(name) AS k FROM player_sessions WHERE left_at IS NULL${srv}`).all(...args) as { k: string }[]).map((r) => r.k));
  } else if (rule.kind === 'week_top') {
    nicks = new Set(topPlayers(now - 7 * DAY, now, Math.max(1, rule.threshold || 1), rule.server_id ?? undefined).map((p) => p.name.toLowerCase()));
  } else {
    const rows = db
      .prepare(`SELECT ulower(name) AS k, SUM(COALESCE(left_at, ?) - joined_at) / 3600000.0 AS h FROM player_sessions WHERE 1 = 1${srv} GROUP BY k`)
      .all(now, ...args) as { k: string; h: number }[];
    nicks = new Set(rows.filter((r) => r.h >= Math.max(1, rule.threshold)).map((r) => r.k));
  }
  return new Set(people.filter((p) => nicks.has(p.nick)).map((p) => p.discordId));
}

/** the name a counter channel should have */
export function counterName(c: Pick<CounterRow, 'template' | 'server_id'>): string {
  const rows = db
    .prepare(`SELECT s.id, ${EFFECTIVE_NAME} AS name, st.online, st.players, st.max_players FROM servers s LEFT JOIN status st ON st.server_id = s.id`)
    .all() as { id: number; name: string; online: number | null; players: number | null; max_players: number | null }[];
  const list = c.server_id ? rows.filter((r) => r.id === c.server_id) : rows;
  const up = list.filter((r) => r.online);
  const vars: Record<string, string> = {
    players: String(up.reduce((n, r) => n + (r.players ?? 0), 0)),
    max: String(up.reduce((n, r) => n + (r.max_players ?? 0), 0)),
    online: String(up.length),
    servers: String(list.length),
    status: list.length && up.length === list.length ? '🟢' : up.length ? '🟡' : '🔴',
    name: c.server_id ? list[0]?.name ?? '' : '',
  };
  // Discord: channel names are 1..100 characters
  return c.template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m).slice(0, 100).trim() || '—';
}

// ---------- the bot ----------

router.get('/internal/discord/sync', internal, (_req, res) => {
  const rules = db.prepare('SELECT * FROM autoroles').all() as RuleRow[];
  const held = db.prepare('SELECT discord_id FROM autorole_members WHERE rule_id = ?');
  const autoroles = rules.map((r) => {
    const want = wanted(r);
    const have = new Set((held.all(r.id) as { discord_id: string }[]).map((x) => x.discord_id));
    return {
      ruleId: r.id,
      guildId: r.guild_id,
      roleId: r.role_id,
      // a few at a time: Discord limits role changes, the rest goes on the next ticks
      add: [...want].filter((id) => !have.has(id)).slice(0, 10),
      remove: [...have].filter((id) => !want.has(id)).slice(0, 10),
    };
  });
  const counters = (db.prepare('SELECT * FROM voice_counters').all() as CounterRow[]).map((c) => ({ id: c.id, channelId: c.channel_id, name: counterName(c) }));
  res.json({ autoroles, counters });
});

router.post('/internal/discord/autoroles/:id', param('id'), internal, (req, res) => {
  const b = z
    .object({ added: z.array(z.string().max(30)).max(50), removed: z.array(z.string().max(30)).max(50), error: z.string().max(300).nullable().optional() })
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM autoroles WHERE id = ?').get(id)) return res.status(404).json({ error: 'Не найдено' });
  db.transaction(() => {
    for (const d of b.data.added) db.prepare('INSERT OR IGNORE INTO autorole_members (rule_id, discord_id) VALUES (?, ?)').run(id, d);
    for (const d of b.data.removed) db.prepare('DELETE FROM autorole_members WHERE rule_id = ? AND discord_id = ?').run(id, d);
    db.prepare('UPDATE autoroles SET last_error = ? WHERE id = ?').run(b.data.error ?? null, id);
  })();
  res.json({ ok: true });
});

router.post('/internal/discord/counters/:id', param('id'), internal, (req, res) => {
  const b = z.object({ error: z.string().max(300).nullable() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  db.prepare('UPDATE voice_counters SET last_error = ? WHERE id = ?').run(b.data.error, Number(req.params.id));
  res.json({ ok: true });
});

/** /online: every server, online first */
router.get('/internal/discord/online', internal, (_req, res) => {
  const rows = db
    .prepare(`SELECT s.id, ${EFFECTIVE_NAME} AS name, s.game, st.online, st.players, st.max_players, st.map FROM servers s LEFT JOIN status st ON st.server_id = s.id ORDER BY s.id`)
    .all() as { id: number; name: string; game: string; online: number | null; players: number | null; max_players: number | null; map: string | null }[];
  const servers = rows
    .map((r) => ({ id: r.id, name: r.name, game: r.game, online: !!r.online, players: r.online ? r.players ?? 0 : 0, maxPlayers: r.max_players ?? 0, map: r.online ? r.map : null }))
    .sort((a, b) => Number(b.online) - Number(a.online) || b.players - a.players);
  res.json({ players: servers.reduce((n, s) => n + s.players, 0), servers, url: publicBase() });
});

/** /status and /player autocomplete: servers or nicks matching what was typed */
router.get('/internal/discord/suggest', internal, (req, res) => {
  const what = String(req.query.what ?? '');
  const q = String(req.query.q ?? '').slice(0, 60).toLowerCase();
  if (what === 'server') {
    const rows = db.prepare(`SELECT s.id, ${EFFECTIVE_NAME} AS name FROM servers s LEFT JOIN status st ON st.server_id = s.id ORDER BY s.id`).all() as { id: number; name: string }[];
    return res.json({ items: rows.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 25).map((r) => ({ name: r.name.slice(0, 100), value: String(r.id) })) });
  }
  const rows = db
    .prepare('SELECT MIN(name) AS name, MAX(joined_at) AS t FROM player_sessions WHERE ulower(name) LIKE ? GROUP BY ulower(name) ORDER BY t DESC LIMIT 25')
    .all(`%${q.replace(/[%_]/g, '')}%`) as { name: string }[];
  res.json({ items: rows.map((r) => ({ name: r.name.slice(0, 100), value: r.name.slice(0, 100) })) });
});

router.get('/internal/discord/player', internal, (req, res) => {
  const card = playerCard(String(req.query.nick ?? '').slice(0, 64));
  if (!card) return res.status(404).json({ error: 'Игрок не найден' });
  const base = publicBase();
  res.json({ ...card, url: base ? `${base}/player/${encodeURIComponent(card.name)}` : null });
});

router.get('/internal/discord/top', internal, (req, res) => {
  const month = req.query.period === 'month';
  const base = publicBase();
  res.json({ period: month ? 'month' : 'week', top: topPlayers(Date.now() - (month ? 30 : 7) * DAY, Date.now(), 10), url: base ? `${base}/community` : null });
});

// ---------- the panel ----------

const roleOf = (guildId: string, roleId: string) => bot.guilds.find((g) => g.id === guildId)?.roles?.find((r) => r.id === roleId) ?? null;
const voiceOf = (channelId: string) => {
  for (const g of bot.guilds) {
    const v = g.voice?.find((c) => c.id === channelId);
    if (v) return { guildName: g.name, name: v.name };
  }
  return null;
};

router.get('/api/discord/extras', admin, (_req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM autorole_members WHERE rule_id = ?');
  const autoroles = (db.prepare('SELECT * FROM autoroles ORDER BY id').all() as RuleRow[]).map((r) => ({
    id: r.id,
    guildId: r.guild_id,
    roleId: r.role_id,
    roleName: roleOf(r.guild_id, r.role_id)?.name ?? null,
    roleColor: roleOf(r.guild_id, r.role_id)?.color ?? 0,
    kind: r.kind,
    threshold: r.threshold,
    serverId: r.server_id,
    members: (count.get(r.id) as { n: number }).n,
    error: r.last_error,
  }));
  const counters = (db.prepare('SELECT * FROM voice_counters ORDER BY id').all() as CounterRow[]).map((c) => ({
    id: c.id,
    channelId: c.channel_id,
    channelName: voiceOf(c.channel_id)?.name ?? null,
    guildName: voiceOf(c.channel_id)?.guildName ?? null,
    template: c.template,
    serverId: c.server_id,
    preview: counterName(c),
    error: c.last_error,
  }));
  const guilds = bot.guilds.map((g) => ({ id: g.id, name: g.name, roles: g.roles ?? [], voice: g.voice ?? [] }));
  res.json({ autoroles, counters, guilds });
});

const serverIdOk = (id: number | null | undefined) => id == null || !!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(id);
const snowflake = z.string().regex(/^\d{15,25}$/);

router.post('/api/discord/autoroles', admin, (req, res) => {
  const b = z
    .object({ guildId: snowflake, roleId: snowflake, kind: z.enum(AUTOROLE_KINDS), threshold: z.number().int().min(0).max(10_000).default(0), serverId: z.number().int().positive().nullable().optional() })
    .safeParse(req.body);
  if (!b.success || !serverIdOk(b.data.serverId)) return res.status(400).json({ error: 'Неверные данные' });
  const { guildId, roleId, kind, threshold, serverId } = b.data;
  const t = kind === 'hours' ? Math.max(1, threshold) : kind === 'week_top' ? Math.min(25, Math.max(1, threshold || 1)) : 0;
  const r = db.prepare('INSERT INTO autoroles (guild_id, role_id, kind, threshold, server_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(guildId, roleId, kind, t, serverId ?? null, Date.now());
  res.json({ id: Number(r.lastInsertRowid) });
});

/** removing a rule forgets its holders; the roles already given stay (the admin removes them in Discord if needed) */
router.delete('/api/discord/autoroles/:id', param('id'), admin, (req, res) => {
  db.prepare('DELETE FROM autoroles WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

router.post('/api/discord/counters', admin, (req, res) => {
  const b = z.object({ channelId: snowflake, template: z.string().trim().min(1).max(100), serverId: z.number().int().positive().nullable().optional() }).safeParse(req.body);
  if (!b.success || !serverIdOk(b.data.serverId)) return res.status(400).json({ error: 'Неверные данные' });
  try {
    const r = db.prepare('INSERT INTO voice_counters (channel_id, template, server_id, created_at) VALUES (?, ?, ?, ?)').run(b.data.channelId, b.data.template, b.data.serverId ?? null, Date.now());
    res.json({ id: Number(r.lastInsertRowid) });
  } catch {
    res.status(409).json({ error: 'Этот канал уже стал счётчиком' });
  }
});

router.delete('/api/discord/counters/:id', param('id'), admin, (req, res) => {
  db.prepare('DELETE FROM voice_counters WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
