/**
 * Giveaways, started by an administrator with /giveaway in Discord: a card with the «🎉 Участвую» button, optional conditions
 * (a role, hours of play), a fair draw when the time comes, /giveaway end and reroll.
 *   POST /internal/giveaways/start|end|reroll|join   (the bot)
 */
import { randomInt } from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { enqueueAlert } from '../alerts/alerts.js';
import { COLORS } from '../discord/palette.js';
import { db } from '../db.js';
import { log } from '../logger.js';
import { vrHoursOf } from '../profile/profileVr.js';
import { draw, joinProblem, validateGiveaway } from './giveawayLogic.js';

db.exec(`
CREATE TABLE IF NOT EXISTS giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prize TEXT NOT NULL,
  winners INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  channel_id TEXT NOT NULL,
  role_id TEXT NOT NULL DEFAULT '',
  min_hours REAL NOT NULL DEFAULT 0,
  host_id TEXT NOT NULL,
  ended INTEGER NOT NULL DEFAULT 0,
  winner_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  PRIMARY KEY (giveaway_id, discord_id)
);
`);

interface Row { id: number; prize: string; winners: number; ends_at: number; channel_id: string; role_id: string; min_hours: number; host_id: string; ended: number; winner_ids: string }
const get = (id: number) => db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id) as Row | undefined;
const entries = (id: number) => (db.prepare('SELECT discord_id FROM giveaway_entries WHERE giveaway_id = ?').all(id) as { discord_id: string }[]).map((r) => r.discord_id);

function conditionsText(g: Row): string {
  const l: string[] = [];
  if (g.role_id) l.push(`роль <@&${g.role_id}>`);
  if (g.min_hours > 0) l.push(`от ${g.min_hours} ч игры (нужен привязанный ник — /link)`);
  return l.length ? `\n📋 Условия: ${l.join(', ')}` : '';
}

function announceNew(g: Row): void {
  enqueueAlert('poll', 'CoreGSM', {
    content: '',
    mention: 'none',
    embed: {
      title: `🎉 Розыгрыш: ${g.prize}`,
      description: `Нажмите кнопку, чтобы участвовать.\n🏆 Победителей: **${g.winners}**\n⏰ Итоги <t:${Math.floor(g.ends_at / 1000)}:R>${conditionsText(g)}\n🆔 Номер розыгрыша: **${g.id}**`,
      color: COLORS.info,
    },
    buttons: [{ customId: `gw:${g.id}`, label: '🎉 Участвую' }],
  }, g.channel_id);
}

/** picks and announces the winners; skip = those who already won (reroll) */
export function finish(g: Row, skip: string[] = []): string[] {
  const winners = draw(entries(g.id), g.winners, (n) => randomInt(n), skip);
  db.prepare('UPDATE giveaways SET ended = 1, winner_ids = ? WHERE id = ?').run(JSON.stringify(winners), g.id);
  enqueueAlert('poll', 'CoreGSM', {
    content: winners.map((w) => `<@${w}>`).join(' '),
    mention: 'none',
    embed: {
      title: `🏆 Итоги розыгрыша: ${g.prize}`,
      description: winners.length ? `Победител${winners.length > 1 ? 'и' : 'ь'}: ${winners.map((w) => `<@${w}>`).join(', ')}\nПоздравляем! Администратор свяжется с вами.` : 'Никто не участвовал — победителей нет.',
      color: winners.length ? COLORS.ok : COLORS.warn,
    },
  }, g.channel_id);
  return winners;
}

export function finishDue(now = Date.now()): number {
  const due = db.prepare('SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= ?').all(now) as Row[];
  for (const g of due) finish(g);
  return due.length;
}

export function registerGiveaways({ app, internal }: { app: Express; internal: RequestHandler }): void {
  app.post('/internal/giveaways/start', internal, (req, res) => {
    const b = z.object({ prize: z.string().max(200), winners: z.number().int(), hours: z.number(), roleId: z.string().regex(/^(\d{15,25})?$/).optional(), minHours: z.number().optional(), channelId: z.string().regex(/^\d{15,25}$/), hostId: z.string().regex(/^\d{15,25}$/) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad body' });
    const bad = validateGiveaway({ prize: b.data.prize, winners: b.data.winners, hours: b.data.hours, minHours: b.data.minHours });
    if (bad) return res.status(400).json({ error: bad });
    const now = Date.now();
    const id = Number(db.prepare('INSERT INTO giveaways (prize, winners, ends_at, channel_id, role_id, min_hours, host_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(b.data.prize.trim(), b.data.winners, now + Math.round(b.data.hours * 3600_000), b.data.channelId, b.data.roleId ?? '', b.data.minHours ?? 0, b.data.hostId, now).lastInsertRowid);
    announceNew(get(id)!);
    res.json({ id });
  });

  app.post('/internal/giveaways/end', internal, (req, res) => {
    const b = z.object({ id: z.number().int(), reroll: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad body' });
    const g = get(b.data.id);
    if (!g) return res.json({ status: 'notfound' });
    if (b.data.reroll) {
      if (!g.ended) return res.json({ status: 'running' });
      return res.json({ status: 'ok', winners: finish(g, JSON.parse(g.winner_ids) as string[]) });
    }
    if (g.ended) return res.json({ status: 'ended' });
    res.json({ status: 'ok', winners: finish(g) });
  });

  app.post('/internal/giveaways/join', internal, (req, res) => {
    const b = z.object({ id: z.number().int(), discordId: z.string().regex(/^\d{15,25}$/), roles: z.array(z.string()).max(250) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad body' });
    const g = get(b.data.id);
    if (!g) return res.json({ status: 'notfound' });
    if (g.ended || g.ends_at <= Date.now()) return res.json({ status: 'ended' });
    let hours: number | null = null;
    if (g.min_hours > 0) {
      const u = db.prepare("SELECT id, game_nick FROM users WHERE discord_id = ? AND status = 'active'").get(b.data.discordId) as { id: number; game_nick: string } | undefined;
      if (u?.game_nick) hours = vrHoursOf(u.id, u.game_nick).hours;
    }
    const p = joinProblem({ roleId: g.role_id, minHours: g.min_hours }, { roles: b.data.roles, hours });
    if (p) return res.json({ status: p, roleId: g.role_id, minHours: g.min_hours, hours });
    const r = db.prepare('INSERT OR IGNORE INTO giveaway_entries (giveaway_id, discord_id) VALUES (?, ?)').run(g.id, b.data.discordId);
    res.json({ status: r.changes ? 'ok' : 'already', total: entries(g.id).length });
  });

  const tick = () => {
    try {
      finishDue();
    } catch (e) {
      log.error('finishing giveaways failed', (e as Error).message);
    }
  };
  setTimeout(tick, 50_000).unref();
  setInterval(tick, 30_000).unref();
}
