/**
 * The journal of the game plugin in one place: what was sent to the game (by hand, by a rule, from Discord), the restarts and the
 * players who linked a game account. And the list of linked players with a way to unlink one.
 */
import type { Express, RequestHandler } from 'express';
import { db } from '../db.js';
import { serverLabel } from './gameNewsVars.js';

export type JournalKind = 'message' | 'auto' | 'discord' | 'restart' | 'link' | 'kick';

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
}

/** which kind a line of the sent-messages log is: by whom it was sent */
export function messageKind(sentBy: string): 'message' | 'auto' | 'discord' {
  if (sentBy.startsWith('Discord:')) return 'discord';
  if (sentBy.startsWith('авто')) return 'auto';
  return 'message';
}

export function journal(opts: { kind?: string; serverId?: number; limit?: number }): JournalEntry[] {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
  const out: JournalEntry[] = [];
  const want = (k: JournalKind) => !opts.kind || opts.kind === 'all' || opts.kind === k;

  if (want('message') || want('auto') || want('discord')) {
    const rows = db.prepare('SELECT id, server_id, server_name, text, status, error, sent_by, sent_at FROM game_news_log ORDER BY id DESC LIMIT 300').all() as {
      id: number; server_id: number | null; server_name: string; text: string; status: string; error: string; sent_by: string; sent_at: number;
    }[];
    for (const r of rows) {
      const kind = messageKind(r.sent_by);
      if (!want(kind) || (opts.serverId && r.server_id !== opts.serverId)) continue;
      out.push({ id: `m${r.id}`, ts: r.sent_at, kind, serverId: r.server_id, serverName: r.server_name, text: r.text, status: r.status, error: r.error, by: r.sent_by });
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
  if (want('kick') && !opts.serverId) {
    const rows = db.prepare("SELECT id, ts, detail FROM audit WHERE action = 'game_kick' ORDER BY id DESC LIMIT 100").all() as { id: number; ts: number; detail: string }[];
    for (const r of rows) out.push({ id: `k${r.id}`, ts: r.ts, kind: 'kick', serverId: null, serverName: '', text: r.detail, status: 'game_kick', error: '', by: '' });
  }
  if (want('link') && !opts.serverId) {
    const rows = db.prepare("SELECT id, ts, action, detail FROM audit WHERE action IN ('game_register', 'game_login', 'game_unlink') ORDER BY id DESC LIMIT 100").all() as { id: number; ts: number; action: string; detail: string }[];
    for (const r of rows) out.push({ id: `l${r.id}`, ts: r.ts, kind: 'link', serverId: null, serverName: '', text: r.detail, status: r.action, error: '', by: '' });
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

const mask = (id: string): string => (id.length > 7 ? `${id.slice(0, 4)}…${id.slice(-3)}` : id);

export function registerGameNewsJournal({ app, admin }: { app: Express; admin: RequestHandler }): void {
  app.get('/api/game-news/journal', admin, (req, res) => {
    const serverId = Number(req.query.server);
    res.json({ items: journal({ kind: String(req.query.kind ?? 'all'), serverId: Number.isInteger(serverId) && serverId > 0 ? serverId : undefined, limit: Number(req.query.limit) || 100 }) });
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
