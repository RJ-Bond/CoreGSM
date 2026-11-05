/**
 * Settings and records of the moderation commands of the bot (/clear, /ban, /unban, /kick, /warn, the context menus):
 *   GET|PUT /api/settings/moderation   the settings (admin): switches, log channel, protected channels, pause, warning
 *     lifetime, the ladder (timeout / kick after so many warnings), the reasons offered, the channel of appeals
 *   GET /internal/moderation   the same for the bot, read at each command
 *   POST /internal/cases   { guildId, userId, userName, modId, modName, kind, reason, link }   writes a record (the case)
 *     and, for a warning, answers the number of active warnings, the earlier ones and the step of the ladder
 *   GET /internal/cases?guild=&user=   the history of a member;  POST /internal/cases/:id/revoke   withdraws a record
 *   GET /api/moderation/cases   the list for the panel (admin);  POST /api/moderation/cases/:id/revoke   withdraws a warning
 * A warning counts while it is not withdrawn and not expired.
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { db, getSetting, setSetting } from '../db.js';
import { bot } from '../discord/botState.js';
import {
  DEFAULT_MUTE_MINUTES, DEFAULT_WARN_TTL_DAYS, MAX_COOLDOWN, MAX_LADDER, MAX_MUTE_MINUTES, MAX_PROTECTED, MAX_REASONS, MAX_REASON_LEN, MAX_WARN_TTL_DAYS,
  cleanCooldown, cleanIds, cleanInt, cleanReasons, expiresAt, ladderFor, parseIds, parseReasons, scaleOf, type Ladder,
} from './moderationLogic.js';

db.exec(`
CREATE TABLE IF NOT EXISTS mod_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL DEFAULT '',
  mod_id TEXT NOT NULL,
  mod_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  revoked_by TEXT
);
CREATE INDEX IF NOT EXISTS mod_cases_user ON mod_cases(guild_id, user_id, id);
CREATE INDEX IF NOT EXISTS mod_cases_kind ON mod_cases(kind, id);
`);
// the first version kept warnings in their own table: they move to the records once
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mod_warns'").get() && (db.prepare('SELECT COUNT(*) AS n FROM mod_cases').get() as { n: number }).n === 0) {
  db.exec("INSERT INTO mod_cases (guild_id, user_id, mod_id, kind, reason, created_at) SELECT guild_id, user_id, mod_id, 'warn', reason, created_at FROM mod_warns");
}

const KINDS = ['warn', 'ban', 'unban', 'kick', 'timeout', 'unmute', 'appeal'] as const;
const PAGE_SIZE = 20;

export const moderationSettings = () => ({
  enabled: getSetting('clear_enabled') !== '0',
  /** /ban, /unban, /kick and /warn */
  punish: getSetting('punish_enabled') !== '0',
  logChannelId: /^\d{15,25}$/.test(getSetting('clear_log_channel') ?? '') ? (getSetting('clear_log_channel') as string) : '',
  protectedChannels: parseIds(getSetting('clear_protected')),
  cooldown: cleanCooldown(getSetting('clear_cooldown')),
  /** days a warning counts (0 = for ever) */
  warnTtlDays: cleanInt(getSetting('warn_ttl_days'), 0, MAX_WARN_TTL_DAYS, DEFAULT_WARN_TTL_DAYS),
  muteAt: cleanInt(getSetting('warn_mute_at'), 0, MAX_LADDER, 0),
  muteMinutes: cleanInt(getSetting('warn_mute_minutes'), 1, MAX_MUTE_MINUTES, DEFAULT_MUTE_MINUTES),
  kickAt: cleanInt(getSetting('warn_kick_at'), 0, MAX_LADDER, 0),
  reasons: parseReasons(getSetting('mod_reasons')),
  /** where appeals of the banned arrive (empty = the log channel) */
  appealChannelId: /^\d{15,25}$/.test(getSetting('appeal_channel') ?? '') ? (getSetting('appeal_channel') as string) : '',
});

const ladderOf = (s: ReturnType<typeof moderationSettings>): Ladder => ({ muteAt: s.muteAt, muteMinutes: s.muteMinutes, kickAt: s.kickAt });

interface CaseRow { id: number; guildId: string; userId: string; userName: string; modId: string; modName: string; kind: string; reason: string; link: string; createdAt: number; expiresAt: number | null; revokedAt: number | null; revokedBy: string | null }
const COLS = 'id, guild_id AS guildId, user_id AS userId, user_name AS userName, mod_id AS modId, mod_name AS modName, kind, reason, link, created_at AS createdAt, expires_at AS expiresAt, revoked_at AS revokedAt, revoked_by AS revokedBy';
const ACTIVE = "kind = 'warn' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)";

const activeWarns = (guild: string, user: string, now: number) => (db.prepare(`SELECT COUNT(*) AS n FROM mod_cases WHERE guild_id = ? AND user_id = ? AND ${ACTIVE}`).get(guild, user, now) as { n: number }).n;
const recentActive = (guild: string, user: string, now: number, limit: number) =>
  db.prepare(`SELECT reason, created_at AS createdAt FROM mod_cases WHERE guild_id = ? AND user_id = ? AND ${ACTIVE} ORDER BY id DESC LIMIT ?`).all(guild, user, now, limit) as { reason: string; createdAt: number }[];

export function registerModeration({ app, admin, internal }: { app: Express; admin: RequestHandler; internal: RequestHandler }): void {
  const payload = () => ({
    ...moderationSettings(),
    maxProtected: MAX_PROTECTED,
    maxCooldown: MAX_COOLDOWN,
    maxWarnTtlDays: MAX_WARN_TTL_DAYS,
    maxLadder: MAX_LADDER,
    maxMuteMinutes: MAX_MUTE_MINUTES,
    maxReasons: MAX_REASONS,
    maxReasonLen: MAX_REASON_LEN,
    channels: bot.guilds.flatMap((g) => g.channels.map((c) => ({ id: c.id, name: c.name, guild: g.name }))),
  });
  app.get('/api/settings/moderation', admin, (_req, res) => res.json(payload()));
  app.put('/api/settings/moderation', admin, (req, res) => {
    const b = z
      .object({
        enabled: z.boolean().optional(),
        punish: z.boolean().optional(),
        logChannelId: z.string().regex(/^(\d{15,25})?$/).optional(),
        appealChannelId: z.string().regex(/^(\d{15,25})?$/).optional(),
        protectedChannels: z.array(z.string().regex(/^\d{15,25}$/)).max(MAX_PROTECTED).optional(),
        cooldown: z.number().int().min(0).max(MAX_COOLDOWN).optional(),
        warnTtlDays: z.number().int().min(0).max(MAX_WARN_TTL_DAYS).optional(),
        muteAt: z.number().int().min(0).max(MAX_LADDER).optional(),
        muteMinutes: z.number().int().min(1).max(MAX_MUTE_MINUTES).optional(),
        kickAt: z.number().int().min(0).max(MAX_LADDER).optional(),
        reasons: z.array(z.string().max(MAX_REASON_LEN * 3)).max(MAX_REASONS * 2).optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Модерация: проверьте каналы, паузу и числа' });
    const d = b.data;
    if (d.enabled !== undefined) setSetting('clear_enabled', d.enabled ? '1' : '0');
    if (d.punish !== undefined) setSetting('punish_enabled', d.punish ? '1' : '0');
    if (d.logChannelId !== undefined) setSetting('clear_log_channel', d.logChannelId);
    if (d.appealChannelId !== undefined) setSetting('appeal_channel', d.appealChannelId);
    if (d.protectedChannels !== undefined) setSetting('clear_protected', JSON.stringify(cleanIds(d.protectedChannels)));
    if (d.cooldown !== undefined) setSetting('clear_cooldown', String(d.cooldown));
    if (d.warnTtlDays !== undefined) setSetting('warn_ttl_days', String(d.warnTtlDays));
    if (d.muteAt !== undefined) setSetting('warn_mute_at', String(d.muteAt));
    if (d.muteMinutes !== undefined) setSetting('warn_mute_minutes', String(d.muteMinutes));
    if (d.kickAt !== undefined) setSetting('warn_kick_at', String(d.kickAt));
    if (d.reasons !== undefined) setSetting('mod_reasons', JSON.stringify(cleanReasons(d.reasons)));
    res.json(payload());
  });
  app.get('/internal/moderation', internal, (_req, res) => res.json(moderationSettings()));

  app.post('/internal/cases', internal, (req, res) => {
    const id = z.string().regex(/^\d{15,25}$/);
    const b = z
      .object({
        guildId: id,
        userId: id,
        userName: z.string().max(100).default(''),
        modId: z.string().regex(/^\d{1,25}$/),
        modName: z.string().max(100).default(''),
        kind: z.enum(KINDS),
        reason: z.string().trim().max(400).default(''),
        link: z.string().max(300).regex(/^(https?:\/\/\S*)?$/).default(''),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad case' });
    const d = b.data;
    const s = moderationSettings();
    const now = Date.now();
    const exp = d.kind === 'warn' ? expiresAt(now, s.warnTtlDays) : null;
    const earlier = d.kind === 'warn' ? recentActive(d.guildId, d.userId, now, 3) : [];
    const r = db.prepare('INSERT INTO mod_cases (guild_id, user_id, user_name, mod_id, mod_name, kind, reason, link, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(d.guildId, d.userId, d.userName, d.modId, d.modName, d.kind, d.reason, d.link, now, exp);
    const total = d.kind === 'warn' ? activeWarns(d.guildId, d.userId, now) : 0;
    res.json({ id: Number(r.lastInsertRowid), createdAt: now, expiresAt: exp, total, recent: earlier, scale: scaleOf(ladderOf(s)), step: d.kind === 'warn' ? ladderFor(total, ladderOf(s)) : null });
  });

  app.get('/internal/cases', internal, (req, res) => {
    const guild = String(req.query.guild ?? '');
    const user = String(req.query.user ?? '');
    if (!/^\d{15,25}$/.test(guild) || !/^\d{15,25}$/.test(user)) return res.status(400).json({ error: 'bad id' });
    const now = Date.now();
    const items = db.prepare(`SELECT ${COLS} FROM mod_cases WHERE guild_id = ? AND user_id = ? AND kind != 'appeal' ORDER BY id DESC LIMIT 10`).all(guild, user) as CaseRow[];
    res.json({ total: activeWarns(guild, user, now), scale: scaleOf(ladderOf(moderationSettings())), items });
  });

  const revoke = (id: number, by: string, onlyWarn: boolean): { ok: boolean; row?: CaseRow; error?: string } => {
    const row = db.prepare(`SELECT ${COLS} FROM mod_cases WHERE id = ?`).get(id) as CaseRow | undefined;
    if (!row) return { ok: false, error: 'not found' };
    if (onlyWarn && row.kind !== 'warn') return { ok: false, error: 'only warnings' };
    if (row.revokedAt) return { ok: true, row };
    db.prepare('UPDATE mod_cases SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(Date.now(), by.slice(0, 100), id);
    return { ok: true, row: { ...row, revokedAt: Date.now(), revokedBy: by } };
  };
  app.post('/internal/cases/:id/revoke', internal, (req, res) => {
    const r = revoke(Number(req.params.id), String(req.body?.by ?? 'bot'), false);
    if (!r.ok || !r.row) return res.status(404).json({ error: r.error });
    res.json({ ok: true, kind: r.row.kind, userId: r.row.userId, total: activeWarns(r.row.guildId, r.row.userId, Date.now()) });
  });

  app.get('/api/moderation/cases', admin, (req, res) => {
    const q = z.object({ kind: z.enum(KINDS).optional(), q: z.string().max(100).optional(), page: z.coerce.number().int().min(0).max(10_000).default(0) }).safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'bad query' });
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.data.kind) { where.push('kind = ?'); args.push(q.data.kind); }
    const text = q.data.q?.trim();
    if (text) {
      const like = `%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      where.push("(user_name LIKE ? ESCAPE '\\' OR user_id LIKE ? ESCAPE '\\' OR reason LIKE ? ESCAPE '\\' OR mod_name LIKE ? ESCAPE '\\')");
      args.push(like, like, like, like);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM mod_cases ${w}`).get(...args) as { n: number }).n;
    const items = db.prepare(`SELECT ${COLS} FROM mod_cases ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, PAGE_SIZE, q.data.page * PAGE_SIZE) as CaseRow[];
    const counts = Object.fromEntries((db.prepare('SELECT kind, COUNT(*) AS n FROM mod_cases GROUP BY kind').all() as { kind: string; n: number }[]).map((r) => [r.kind, r.n]));
    res.json({ items, total, page: q.data.page, pageSize: PAGE_SIZE, counts, now: Date.now() });
  });
  app.post('/api/moderation/cases/:id/revoke', admin, (req, res) => {
    const r = revoke(Number(req.params.id), 'panel', true);
    if (!r.ok) return res.status(r.error === 'not found' ? 404 : 400).json({ error: r.error });
    res.json({ ok: true });
  });
}
