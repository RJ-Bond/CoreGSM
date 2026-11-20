/**
 * The journal of the game plugin in one place: what was sent to the game (by hand, by a rule, from Discord), the restarts and the
 * players who linked a game account. And the list of linked players with a way to unlink one.
 */
import type { Express, RequestHandler } from 'express';
import { db } from '../db.js';
import { serverLabel } from './gameNewsVars.js';
import { journalDays, pruneJournalSometimes } from './gameNewsPluginLog.js';

export type JournalKind = 'message' | 'auto' | 'discord' | 'restart' | 'link' | 'mod' | 'plugin' | 'conn';

export interface JournalEntry {
  id: string;
  ts: number;
  kind: JournalKind;
  serverId: number | null;
  serverName: string;
  text: string;
  /** message: queued | delivered | expired | failed; restart: counting | done | cancelled | missed | replaced; link: the action */
  status: string;
  error: string;
  by: string;
  /** a message: when the plugin took it, and how many players saw it (null = the plugin did not say) */
  deliveredAt?: number | null;
  shown?: number | null;
}

/** which kind a line of the sent-messages log is: by whom it was sent */
export function messageKind(sentBy: string): 'message' | 'auto' | 'discord' {
  if (sentBy.startsWith('Discord:')) return 'discord';
  if (sentBy.startsWith('авто')) return 'auto';
  return 'message';
}

export function journal(opts: { kind?: string; serverId?: number; limit?: number; since?: number; until?: number }): JournalEntry[] {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const from = opts.since ?? 0;
  const to = opts.until ?? Number.MAX_SAFE_INTEGER;
  const out: JournalEntry[] = [];
  const want = (k: JournalKind) => !opts.kind || opts.kind === 'all' || opts.kind === 'problems' || opts.kind === k;

  if (want('message') || want('auto') || want('discord')) {
    const rows = db.prepare('SELECT id, server_id, server_name, text, status, error, sent_by, sent_at, delivered_at, shown FROM game_news_log ORDER BY id DESC LIMIT 500').all() as {
      id: number; server_id: number | null; server_name: string; text: string; status: string; error: string; sent_by: string; sent_at: number; delivered_at: number | null; shown: number | null;
    }[];
    for (const r of rows) {
      const kind = messageKind(r.sent_by);
      if (!want(kind) || (opts.serverId && r.server_id !== opts.serverId) || r.sent_at < from || r.sent_at > to) continue;
      out.push({ id: `m${r.id}`, ts: r.sent_at, kind, serverId: r.server_id, serverName: r.server_name, text: r.text, status: r.status, error: r.error, by: r.sent_by, deliveredAt: r.delivered_at, shown: r.shown });
    }
  }
  if (want('restart')) {
    const rows = db.prepare('SELECT * FROM game_restart_log ORDER BY id DESC LIMIT 100').all() as {
      id: number; server_id: number; started_at: number; total_sec: number; requested_by: string; source: string; outcome: string;
    }[];
    for (const r of rows) {
      if (opts.serverId && r.server_id !== opts.serverId) continue;
      out.push({ id: `r${r.id}`, ts: r.started_at, kind: 'restart', serverId: r.server_id, serverName: serverLabel(r.server_id), text: `${Math.round(r.total_sec / 60)}`, status: r.outcome, error: '', by: `${r.requested_by || '—'} · ${r.source}` });
    }
  }
  if (want('mod')) {
    const rows = db.prepare('SELECT * FROM game_mod_log ORDER BY id DESC LIMIT 200').all() as { id: number; ts: number; kind: string; platform_id: string; nick: string; admin: string; reason: string; server_id: number; until: number }[];
    for (const r of rows) {
      if (opts.serverId && r.server_id !== opts.serverId) continue;
      out.push({ id: `k${r.id}`, ts: r.ts, kind: 'mod', serverId: r.server_id || null, serverName: r.server_id ? serverLabel(r.server_id) : '', text: r.nick, status: r.kind, error: r.reason, by: r.admin });
    }
  }
  if (want('link') && !opts.serverId) {
    const rows = db.prepare("SELECT id, ts, action, detail FROM audit WHERE action IN ('game_register', 'game_login', 'game_unlink') ORDER BY id DESC LIMIT 100").all() as { id: number; ts: number; action: string; detail: string }[];
    for (const r of rows) out.push({ id: `l${r.id}`, ts: r.ts, kind: 'link', serverId: null, serverName: '', text: r.detail, status: r.action, error: '', by: '' });
  }
  if (want('plugin')) {
    const rows = db.prepare('SELECT id, server_id, ts, kind, name, text FROM game_plugin_log WHERE ts >= ? AND ts <= ? ORDER BY id DESC LIMIT 500').all(from, to) as { id: number; server_id: number; ts: number; kind: string; name: string; text: string }[];
    for (const r of rows) {
      if (opts.serverId && r.server_id !== opts.serverId) continue;
      out.push({ id: `p${r.id}`, ts: r.ts, kind: 'plugin', serverId: r.server_id, serverName: serverLabel(r.server_id), text: r.text, status: r.kind, error: '', by: r.name });
    }
  }
  // the players who left by timeout: shown only next to something else (see `around`), they have their own list in «Входы и выходы»
  if (opts.kind === 'conn') {
    const rows = db.prepare("SELECT id, server_id, ts, nick, reason, minutes FROM game_connections WHERE kind = 'leave' AND reason LIKE 'Timeout%' AND ts >= ? AND ts <= ? ORDER BY ts DESC LIMIT 200").all(from, to) as { id: number; server_id: number; ts: number; nick: string; reason: string; minutes: number }[];
    for (const r of rows) {
      if (opts.serverId && r.server_id !== opts.serverId) continue;
      out.push({ id: `c${r.id}`, ts: r.ts, kind: 'conn', serverId: r.server_id, serverName: serverLabel(r.server_id), text: r.nick, status: r.reason, error: '', by: '' });
    }
  }
  // «problems»: only what did not go well (a message that did not reach the game, a missed restart, a note of the plugin)
  return out.filter((e) => e.ts >= from && e.ts <= to && (opts.kind !== 'problems' || isProblem(e))).sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/** the entries within a few minutes of a moment (all kinds, and the timeouts): what happened around a failure */
export function around(ts: number, serverId: number | undefined, spanMs = 5 * 60_000): JournalEntry[] {
  const base = { serverId, since: ts - spanMs, until: ts + spanMs, limit: 200 };
  return [...journal({ ...base, kind: 'all' }), ...journal({ ...base, kind: 'conn' })].sort((a, b) => b.ts - a.ts);
}

export interface JournalCounts { [kind: string]: number; problems: number }

/** how many entries of each kind the last day has, and how many of them are a problem (not delivered, a missed restart, a note of the plugin) */
export function counts(serverId: number | undefined, now = Date.now()): JournalCounts {
  const day = journal({ kind: 'all', serverId, since: now - 86_400_000, limit: 500 });
  const c: JournalCounts = { all: day.length, problems: 0 };
  for (const e of day) {
    c[e.kind] = (c[e.kind] ?? 0) + 1;
    if (isProblem(e)) c.problems += 1;
  }
  return c;
}

export const isProblem = (e: JournalEntry): boolean =>
  ((e.kind === 'message' || e.kind === 'auto' || e.kind === 'discord') && (e.status === 'failed' || e.status === 'expired')) ||
  (e.kind === 'restart' && e.status === 'missed') ||
  (e.kind === 'plugin' && e.status !== 'save');

const mask = (id: string): string => (id.length > 7 ? `${id.slice(0, 4)}…${id.slice(-3)}` : id);

export function registerGameNewsJournal({ app, admin }: { app: Express; admin: RequestHandler }): void {
  app.get('/api/game-news/journal', admin, (req, res) => {
    const serverId = Number(req.query.server);
    const sid = Number.isInteger(serverId) && serverId > 0 ? serverId : undefined;
    pruneJournalSometimes();
    // «Рядом»: everything within five minutes of a moment
    const at = Number(req.query.around);
    if (Number.isFinite(at) && at > 0) return res.json({ items: around(at, sid) });
    res.json({
      items: journal({ kind: String(req.query.kind ?? 'all'), serverId: sid, limit: Number(req.query.limit) || 100 }),
      counts: counts(sid),
      retentionDays: journalDays(),
    });
  });

  // the players whose game account is linked to an account of the panel
  app.get('/api/game-news/links', admin, (_req, res) => {
    const rows = db.prepare(
      `SELECT g.platform_id, g.nick, g.created_at, u.id AS user_id, u.username, u.status, u.discord_id
       FROM game_identities g JOIN users u ON u.id = g.user_id ORDER BY g.created_at DESC LIMIT 500`,
    ).all() as { platform_id: string; nick: string; created_at: number; user_id: number; username: string; status: string; discord_id: string | null }[];
    res.json({
      items: rows.map((r) => ({ platformId: r.platform_id, masked: mask(r.platform_id), nick: r.nick, username: r.username, status: r.status, discord: !!r.discord_id, linkedAt: r.created_at })),
    });
  });

  // «Отвязать»: the game account is no longer linked (the account of the panel stays; the player can link again with .login)
  app.delete('/api/game-news/links/:platformId', admin, (req, res) => {
    const id = String(req.params.platformId);
    if (!/^\d{5,25}$/.test(id)) return res.status(400).json({ error: 'Проверьте поля' });
    const row = db.prepare('SELECT u.username FROM game_identities g JOIN users u ON u.id = g.user_id WHERE g.platform_id = ?').get(id) as { username: string } | undefined;
    if (!row) return res.status(404).json({ error: 'Привязка не найдена' });
    db.prepare('DELETE FROM game_identities WHERE platform_id = ?').run(id);
    db.prepare('INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)').run(Date.now(), 'admin', 'game_unlink', row.username);
    res.json({ ok: true });
  });
}
