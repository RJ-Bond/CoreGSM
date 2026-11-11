/**
 * The history of the settings a person sets, and a way back.
 *
 *   GET  /api/settings/history?limit=50    who changed which setting, from what to what (administrator)
 *   POST /api/settings/history/:id/revert  puts the value the setting had before that change (administrator)
 *
 * Only the settings in portableSettings.ts are written here: no secrets, no counters. A revert is itself a change,
 * so it appears in the history and can be reverted again.
 */
import express from 'express';
import { admin, type AuthedRequest } from '../security/auth.js';
import { db, setSetting } from '../db.js';
import { param, wrap } from '../http.js';
import { isHistoryKey } from './portableSettings.js';

export const router = express.Router();

interface Row { id: number; ts: number; actor: string | null; key: string; old_value: string | null; new_value: string | null }

router.get('/api/settings/history', admin, (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
  const rows = db.prepare('SELECT id, ts, actor, key, old_value, new_value FROM settings_history ORDER BY id DESC LIMIT ?').all(limit) as Row[];
  res.json(rows.map((r) => ({ id: r.id, ts: r.ts, actor: r.actor, key: r.key, from: r.old_value, to: r.new_value })));
});

router.post(
  '/api/settings/history/:id/revert',
  admin,
  param('id'),
  wrap((req: AuthedRequest, res) => {
    const row = db.prepare('SELECT id, key, old_value FROM settings_history WHERE id = ?').get(Number(req.params.id)) as Pick<Row, 'id' | 'key' | 'old_value'> | undefined;
    if (!row) return res.status(404).json({ error: 'Запись не найдена' });
    if (!isHistoryKey(row.key)) return res.status(400).json({ error: 'Эту настройку вернуть нельзя' });
    // empty = the setting did not exist before the change: it is removed again
    setSetting(row.key, row.old_value);
    res.json({ ok: true, key: row.key, value: row.old_value });
  }),
);
