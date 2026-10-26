/** Internal API of the bot (not exposed by nginx): configuration, status reports, bindings, embeds, cards. */
import express from 'express';
import { z } from 'zod';
import { internal } from '../auth.js';
import { bot } from '../botState.js';
import { renderCard } from '../card.js';
import { type BindingRow, db, EFFECTIVE_NAME, getSetting, type ServerRow, setSetting } from '../db.js';
import { refreshServer } from '../gsm.js';
import { param, wrap } from '../http.js';
import { addPing } from '../botLatencyLogic.js';
import { buildPresence } from '../presence.js';
import { currentStyle } from '../discordStyleState.js';
import { welcomeSettings } from '../welcome.js';
import { parseLayout } from '../embedLayout.js';
import { embedFor, intervalParam, serializeBinding, SELECT_SERVERS, SERVER_ORDER, serialize, type ServerJoin } from '../serverData.js';

export const router = express.Router();

// the status line of the bot in the member list: the dot colour and the lines it rotates through
router.get('/internal/presence', internal, (_req, res) => {
  const rows = db.prepare(`${SELECT_SERVERS} ORDER BY ${SERVER_ORDER}`).all() as ServerJoin[];
  res.json(buildPresence(rows.map(serialize).map((s) => ({ name: s.name, online: s.online, players: s.players, maxPlayers: s.maxPlayers, hasStatus: s.hasStatus }))));
});

router.get('/internal/servers/:id/embed', internal, (req, res) => {
  const e = embedFor(Number(req.params.id), intervalParam(req.query.interval), parseLayout(req.query.layout));
  if (!e) return res.status(404).json({ error: 'not found' });
  res.json(e);
});

// the same PNG card, for the bot (works while the panel is private)
router.get(
  '/internal/card/:id.png', param('id'),
  internal,
  wrap(async (req, res) => {
    const buf = await renderCard(Number(req.params.id));
    if (!buf) return res.status(404).json({ error: 'not found' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }).send(buf);
  }),
);

// "Refresh" button on the Discord message: query the game server right now
router.post(
  '/internal/servers/:id/refresh',
  internal,
  wrap(async (req, res) => {
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(Number(req.params.id)) as ServerRow | undefined;
    if (!row) return res.status(404).json({ error: 'not found' });
    await refreshServer(row);
    res.json({ ok: true });
  }),
);

router.get('/internal/config', internal, (_req, res) => {
  res.json({ discordToken: getSetting('discord_token') ?? '', proxyUrl: getSetting('proxy_url') ?? '', welcome: welcomeSettings().enabled, style: (() => { const s = currentStyle(); return { footer: s.footer, accent: s.accent, logoUrl: s.logoUrl }; })() });
});

router.post('/internal/bot-guilds', internal, (req, res) => {
  const b = z
    .array(
      z.object({
        id: z.string().max(30),
        name: z.string().max(120),
        hidden: z.number().int().min(0).optional(),
        channels: z.array(z.object({ id: z.string().max(30), name: z.string().max(120), missing: z.array(z.string().max(40)).max(4).optional() })).max(300),
        roles: z.array(z.object({ id: z.string().max(30), name: z.string().max(120), color: z.number().int().min(0).max(0xffffff) })).max(250).optional(),
        voice: z.array(z.object({ id: z.string().max(30), name: z.string().max(120) })).max(250).optional(),
      }),
    )
    .max(60)
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'bad body' });
  bot.guilds = b.data;
  setSetting('bot_guilds', JSON.stringify(b.data));
  res.json({ ok: true });
});

router.post('/internal/bot-status', internal, (req, res) => {
  const b = z
    .object({
      state: z.enum(['idle', 'connecting', 'online', 'error']),
      tag: z.string().max(100).nullable().optional(),
      clientId: z.string().regex(/^\d{15,25}$/).nullable().optional(),
      error: z.string().max(300).nullable().optional(),
      commands: z.number().int().min(0).max(200).nullable().optional(),
      ping: z.number().min(0).max(120_000).nullable().optional(),
    })
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'bad body' });
  bot.status = { state: b.data.state, tag: b.data.tag ?? null, clientId: b.data.clientId ?? null, error: b.data.error ?? null, commands: b.data.commands ?? null, updatedAt: Date.now() };
  if (b.data.state === 'online' && b.data.ping != null) addPing(bot.latency, b.data.ping, Date.now());
  res.json({ ok: true });
});

router.get('/internal/bindings', internal, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT b.*, ${EFFECTIVE_NAME} AS server_name FROM bindings b JOIN servers s ON s.id = b.server_id LEFT JOIN status st ON st.server_id = s.id WHERE b.enabled = 1`,
    )
    .all() as (BindingRow & { server_name: string })[];
  res.json(rows.map((r) => ({ ...serializeBinding(r), serverName: r.server_name })));
});

const bindingForBot = (id: number) => {
  const r = db
    .prepare(`SELECT b.*, ${EFFECTIVE_NAME} AS server_name FROM bindings b JOIN servers s ON s.id = b.server_id LEFT JOIN status st ON st.server_id = s.id WHERE b.id = ?`)
    .get(id) as (BindingRow & { server_name: string }) | undefined;
  return r ? { ...serializeBinding(r), serverName: r.server_name } : null;
};

// one binding, enabled or not (the buttons on the Discord message work for paused ones too)
router.get('/internal/bindings/:id', internal, (req, res) => {
  const b = bindingForBot(Number(req.params.id));
  if (!b) return res.status(404).json({ error: 'not found' });
  res.json(b);
});
for (const [action, enabled] of [['pause', 0], ['resume', 1]] as const) {
  router.post(`/internal/bindings/:id/${action}`, internal, (req, res) => {
    const id = Number(req.params.id);
    const r = db.prepare('UPDATE bindings SET enabled = ? WHERE id = ?').run(enabled, id);
    if (!r.changes) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, binding: bindingForBot(id) });
  });
}

router.patch('/internal/bindings/:id', internal, (req, res) => {
  const b = z
    .object({ messageId: z.string().nullable().optional(), error: z.string().max(300).nullable().optional() })
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'bad body' });
  const id = Number(req.params.id);
  if (b.data.messageId !== undefined) db.prepare('UPDATE bindings SET message_id = ? WHERE id = ?').run(b.data.messageId, id);
  db.prepare('UPDATE bindings SET last_update = ?, last_error = ? WHERE id = ?').run(Date.now(), b.data.error ?? null, id);
  res.json({ ok: true });
});
