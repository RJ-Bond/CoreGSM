/**
 * Notes of the administrators on the public status page: «Идут работы на сервере», «Причина найдена», «Всё починено».
 *
 *   GET    /api/status/notes        every note (administrators with the «maintenance» right)
 *   POST   /api/status/notes        a new note
 *   PATCH  /api/status/notes/:id    edit a note, or close / reopen it ({ resolved })
 *   DELETE /api/status/notes/:id    delete a note
 * The open notes and the ones closed within two weeks go to everybody inside GET /api/status.
 */
import type { Express, Request, RequestHandler } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { NOTE_LEVELS, visibleNotes, type NoteRow } from './statusNotesLogic.js';

db.exec(`
CREATE TABLE IF NOT EXISTS status_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'info',
  server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER,
  created_by TEXT NOT NULL DEFAULT ''
);
`);

const NAME = "SELECT COALESCE(NULLIF(name, ''), host || ':' || port) AS n FROM servers WHERE id = ?";
const serialize = (r: NoteRow) => ({
  id: r.id,
  title: r.title,
  body: r.body,
  level: r.level,
  serverId: r.server_id,
  serverName: r.server_id == null ? null : ((db.prepare(NAME).get(r.server_id) as { n: string } | undefined)?.n ?? null),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  resolvedAt: r.resolved_at,
});

/** what the public status page shows */
export function publicNotes(now = Date.now()) {
  const rows = db.prepare('SELECT * FROM status_notes ORDER BY created_at DESC LIMIT 200').all() as NoteRow[];
  return visibleNotes(rows, now).map(serialize);
}

const create = z.object({
  title: z.string().trim().min(1, 'Укажите заголовок').max(120, 'Заголовок не длиннее 120 символов'),
  body: z.string().trim().max(1000, 'Текст не длиннее 1000 символов').default(''),
  level: z.enum(NOTE_LEVELS).default('info'),
  serverId: z.number().int().positive().nullable().optional(),
});
const patch = create.partial().extend({ resolved: z.boolean().optional() });

export function registerStatusNotes({ app, admin }: { app: Express; admin: RequestHandler }): void {
  const actor = (req: Request) => (req as Request & { user?: { username?: string } }).user?.username ?? '';
  const serverOk = (id: number | null | undefined) => id == null || !!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(id);

  app.get('/api/status/notes', admin, (_req, res) => {
    res.json((db.prepare('SELECT * FROM status_notes ORDER BY resolved_at IS NOT NULL, created_at DESC LIMIT 100').all() as NoteRow[]).map(serialize));
  });

  app.post('/api/status/notes', admin, (req, res) => {
    const b = create.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля' });
    if (!serverOk(b.data.serverId)) return res.status(404).json({ error: 'Сервер не найден' });
    const now = Date.now();
    const r = db
      .prepare('INSERT INTO status_notes (title, body, level, server_id, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(b.data.title, b.data.body, b.data.level, b.data.serverId ?? null, now, now, actor(req));
    res.status(201).json(serialize(db.prepare('SELECT * FROM status_notes WHERE id = ?').get(r.lastInsertRowid) as NoteRow));
  });

  app.patch('/api/status/notes/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM status_notes WHERE id = ?').get(id) as NoteRow | undefined;
    if (!cur) return res.status(404).json({ error: 'Заметка не найдена' });
    const b = patch.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля' });
    if (b.data.serverId !== undefined && !serverOk(b.data.serverId)) return res.status(404).json({ error: 'Сервер не найден' });
    const now = Date.now();
    const next = {
      title: b.data.title ?? cur.title,
      body: b.data.body ?? cur.body,
      level: b.data.level ?? cur.level,
      server_id: b.data.serverId === undefined ? cur.server_id : b.data.serverId,
      resolved_at: b.data.resolved === undefined ? cur.resolved_at : b.data.resolved ? (cur.resolved_at ?? now) : null,
    };
    db.prepare('UPDATE status_notes SET title = ?, body = ?, level = ?, server_id = ?, resolved_at = ?, updated_at = ? WHERE id = ?').run(next.title, next.body, next.level, next.server_id, next.resolved_at, now, id);
    res.json(serialize(db.prepare('SELECT * FROM status_notes WHERE id = ?').get(id) as NoteRow));
  });

  app.delete('/api/status/notes/:id', admin, (req, res) => {
    const r = db.prepare('DELETE FROM status_notes WHERE id = ?').run(Number(req.params.id));
    if (!r.changes) return res.status(404).json({ error: 'Заметка не найдена' });
    res.json({ ok: true });
  });
}
