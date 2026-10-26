/** Discord bindings: which server is posted to which channel, the channel list and the embed preview. */
import express from 'express';
import { z } from 'zod';
import { admin, staff } from '../auth.js';
import { bot } from '../botState.js';
import { type BindingRow, db, getSetting, setSetting } from '../db.js';
import { parseLayout } from '../embedLayout.js';
import { cleanExtra, embedFor, extraIds, intervalParam, playersShown, serializeBinding } from '../serverData.js';

export const router = express.Router();

// ---------- discord bindings ----------
const bindingSchema = z.object({
  serverId: z.number().int(),
  // more servers in the same message (Discord allows up to 10 embeds in one message)
  extraServerIds: z.array(z.number().int()).max(9).optional(),
  channelId: z.string().regex(/^\d{15,25}$/, 'ID канала — число из 15–25 цифр'),
  intervalSec: z.number().int().min(30).max(3600).default(60),
  enabled: z.boolean().default(true),
  // omitted on update = keep the current style
  style: z.enum(['embed', 'card', 'both']).optional(),
  layout: z.enum(['detailed', 'compact', 'minimal']).optional(),
});

router.get('/api/discord/channels', staff, (_req, res) => {
  res.json(bot.guilds);
});

const embedSettings = () => ({ playersShown: playersShown(), chart: getSetting('embed_chart') !== '0', iconTile: getSetting('embed_icon_tile') === '1' });
router.get('/api/settings/embed', admin, (_req, res) => {
  res.json(embedSettings());
});
router.put('/api/settings/embed', admin, (req, res) => {
  const b = z.object({ playersShown: z.number().int().min(0).max(20).optional(), chart: z.boolean().optional(), iconTile: z.boolean().optional() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Число ников: от 0 до 20' });
  if (b.data.playersShown !== undefined) setSetting('embed_players_shown', String(b.data.playersShown));
  if (b.data.chart !== undefined) setSetting('embed_chart', b.data.chart ? '1' : '0');
  if (b.data.iconTile !== undefined) setSetting('embed_icon_tile', b.data.iconTile ? '1' : '0');
  res.json(embedSettings());
});

router.get('/api/servers/:id/embed', admin, (req, res) => {
  const e = embedFor(Number(req.params.id), intervalParam(req.query.interval), parseLayout(req.query.layout));
  if (!e) return res.status(404).json({ error: 'Сервер не найден' });
  res.json(e);
});

router.get('/api/bindings', admin, (_req, res) => {
  res.json((db.prepare('SELECT * FROM bindings ORDER BY id').all() as BindingRow[]).map(serializeBinding));
});

router.post('/api/bindings', admin, (req, res) => {
  const b = bindingSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Неверные данные' });
  if (!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(b.data.serverId)) {
    return res.status(400).json({ error: 'Сервер не найден' });
  }
  const info = db
    .prepare('INSERT INTO bindings (server_id, channel_id, interval_sec, enabled, style, layout, extra_ids) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(b.data.serverId, b.data.channelId, b.data.intervalSec, b.data.enabled ? 1 : 0, b.data.style ?? 'embed', b.data.layout ?? 'detailed', JSON.stringify(cleanExtra(b.data.serverId, b.data.extraServerIds)));
  res.status(201).json(serializeBinding(db.prepare('SELECT * FROM bindings WHERE id = ?').get(info.lastInsertRowid) as BindingRow));
});

router.put('/api/bindings/:id', admin, (req, res) => {
  const b = bindingSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Неверные данные' });
  const id = Number(req.params.id);
  const old = db.prepare('SELECT * FROM bindings WHERE id = ?').get(id) as BindingRow | undefined;
  if (!old) return res.status(404).json({ error: 'Не найдено' });
  // moving to another channel/server means a new message must be posted
  const resetMsg = old.channel_id !== b.data.channelId || old.server_id !== b.data.serverId;
  // omitted = keep the current extra servers (a pause/resume from the list does not send them)
  const extra = b.data.extraServerIds === undefined ? extraIds(old) : cleanExtra(b.data.serverId, b.data.extraServerIds);
  db.prepare(
    'UPDATE bindings SET server_id=?, channel_id=?, interval_sec=?, enabled=?, style=?, layout=?, extra_ids=?, message_id=CASE WHEN ? THEN NULL ELSE message_id END WHERE id=?',
  ).run(b.data.serverId, b.data.channelId, b.data.intervalSec, b.data.enabled ? 1 : 0, b.data.style ?? old.style, b.data.layout ?? parseLayout(old.layout), JSON.stringify(extra), resetMsg ? 1 : 0, id);
  res.json(serializeBinding(db.prepare('SELECT * FROM bindings WHERE id = ?').get(id) as BindingRow));
});

router.delete('/api/bindings/:id', admin, (req, res) => {
  const r = db.prepare('DELETE FROM bindings WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});
