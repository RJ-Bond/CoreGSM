/**
 * One outage with its own address: what happened, in order, and the players around it.
 *   GET /api/status/incidents/:serverId/:start    (whoever may open the panel)
 * The outage is taken from the poll history, so it is here as long as the history is kept.
 */
import express from 'express';
import { db } from '../db.js';
import { viewer, isAdmin } from '../security/auth.js';
import { DAY, incidentsSince } from '../alerts/incidents.js';
import { getServer, publicServer } from '../monitoring/serverData.js';
import type { NoteRow } from '../alerts/statusNotesLogic.js';
import { buildTimeline, samplePoints, type ChangeRow } from './incidentLogic.js';

export const router = express.Router();
const HOUR = 3_600_000;

router.get('/api/status/incidents/:serverId/:start', viewer, (req, res) => {
  const serverId = Number(req.params.serverId);
  const start = Number(req.params.start);
  const sv = Number.isInteger(serverId) && serverId > 0 && Number.isInteger(start) && start > 0 ? getServer(serverId) : null;
  const now = Date.now();
  const incident = sv ? incidentsSince(start - DAY, serverId, now).find((i) => i.start === start) : undefined;
  if (!sv || !incident) return res.status(404).json({ error: 'Сбой не найден: возможно, история опросов за это время уже удалена' });
  const shown = isAdmin(req) ? sv : publicServer(sv);
  const end = incident.end ?? now;
  const notes = db
    .prepare('SELECT * FROM status_notes WHERE (server_id = ? OR server_id IS NULL) AND created_at <= ? AND (resolved_at IS NULL OR resolved_at >= ?) AND created_at >= ? ORDER BY created_at LIMIT 20')
    .all(serverId, end + DAY, start - HOUR, start - DAY) as NoteRow[];
  const changes = db
    .prepare('SELECT ts, kind, old_value AS oldValue, new_value AS newValue FROM server_changes WHERE server_id = ? AND ts >= ? AND ts <= ? ORDER BY ts LIMIT 20')
    .all(serverId, start - 6 * HOUR, end + 6 * HOUR) as ChangeRow[];
  const history = db
    .prepare('SELECT ts, online, players FROM history WHERE server_id = ? AND ts >= ? AND ts <= ? ORDER BY ts')
    .all(serverId, start - HOUR, end + HOUR) as { ts: number; online: number; players: number }[];
  res.set('Cache-Control', 'private, max-age=15').json({
    incident: { ...incident, serverName: shown.name, game: shown.game },
    timeline: buildTimeline(incident, notes, changes),
    points: samplePoints(history, 240),
  });
});
