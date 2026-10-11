/**
 * News: messages written in the panel and posted to a Discord channel by the bot.
 * A news item is a small state machine the bot works through:
 *   draft -> (queued | scheduled) -> sending -> sent        (post)
 *   sent -> edit_queued -> sent                              (edit the posted message)
 *   sent -> delete_queued -> (row removed)                   (delete the posted message)
 */
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db, getSetting, setSetting } from './db.js';

const IMG_DIR = path.join(path.dirname(process.env.DB_PATH ?? './data/coregsm.db'), 'news');
fs.mkdirSync(IMG_DIR, { recursive: true });

db.exec(`
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  scheduled_at INTEGER,
  sent_at INTEGER,
  message_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

interface NewsRow {
  id: number;
  status: string;
  channel_id: string;
  payload: string;
  scheduled_at: number | null;
  sent_at: number | null;
  message_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

// ---------- validation (Discord limits) ----------
const link = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Ссылка должна начинаться с http:// или https://');

const embedSchema = z.object({
  title: z.string().max(256, 'Заголовок: не более 256 символов').optional(),
  url: link.optional(),
  description: z.string().max(4096, 'Текст: не более 4096 символов').optional(),
  color: z.number().int().min(0).max(0xffffff).optional(),
  author: z.object({ name: z.string().max(256), iconUrl: link.optional() }).optional(),
  thumbnailUrl: link.optional(),
  image: z.object({ url: link.optional(), upload: z.string().regex(/^[a-f0-9]{24}\.(png|jpg|gif|webp)$/).optional() }).optional(),
  fields: z
    .array(
      z.object({
        name: z.string().min(1, 'У каждого поля должно быть название').max(256),
        value: z.string().min(1, 'У каждого поля должен быть текст').max(1024, 'Текст поля: не более 1024 символов'),
        inline: z.boolean().optional(),
      }),
    )
    .max(25, 'Полей не больше 25')
    .optional(),
  footer: z.object({ text: z.string().max(2048) }).optional(),
  timestamp: z.boolean().optional(),
});

const payloadSchema = z.object({
  content: z.string().max(2000, 'Сообщение над embed: не более 2000 символов').default(''),
  mention: z.enum(['none', 'here', 'everyone']).default('none'),
  embed: embedSchema.optional(),
});

export type NewsPayload = z.infer<typeof payloadSchema>;

const bodySchema = z.object({
  channelId: z.string().regex(/^\d{15,25}$/, 'Выберите канал для новости'),
  payload: payloadSchema,
  action: z.enum(['draft', 'now', 'schedule']),
  scheduledAt: z.number().int().optional(),
});

/** Drops empty strings, so "no title" is really absent. */
function tidy(p: NewsPayload): NewsPayload {
  const e = p.embed;
  if (!e) return { ...p, embed: undefined };
  const out = { ...e };
  for (const k of ['title', 'url', 'description', 'thumbnailUrl'] as const) if (!out[k]?.trim()) delete out[k];
  if (out.author && !out.author.name.trim()) delete out.author;
  else if (out.author && !out.author.iconUrl) delete out.author.iconUrl;
  if (out.footer && !out.footer.text.trim()) delete out.footer;
  if (out.image && !out.image.url && !out.image.upload) delete out.image;
  else if (out.image && !out.image.url) delete out.image.url;
  if (!out.fields?.length) delete out.fields;
  const hasEmbed = Object.keys(out).some((k) => k !== 'color' && k !== 'timestamp') || (out.timestamp && Object.keys(out).length > 1);
  return { ...p, embed: hasEmbed ? out : undefined };
}

function embedLength(e: NonNullable<NewsPayload['embed']>): number {
  return (
    (e.title?.length ?? 0) +
    (e.description?.length ?? 0) +
    (e.author?.name.length ?? 0) +
    (e.footer?.text.length ?? 0) +
    (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0)
  );
}

/** Returns an error message when the payload cannot be posted, otherwise null. */
function check(p: NewsPayload): string | null {
  if (!p.content.trim() && !p.embed) return 'Напишите текст или заполните embed: пустое сообщение отправить нельзя';
  if (p.embed && embedLength(p.embed) > 6000) return 'Embed длиннее 6000 символов (лимит Discord): сократите текст';
  return null;
}

const titleOf = (p: NewsPayload) => p.embed?.title?.trim() || p.content.trim().slice(0, 70) || p.embed?.description?.trim().slice(0, 70) || 'Без названия';

type ChannelInfo = (id: string) => { channelName: string | null; guildName: string | null; guildId: string | null };

export function registerNews(deps: {
  app: express.Express;
  admin: RequestHandler;
  viewer: RequestHandler;
  internal: RequestHandler;
  channelInfo: ChannelInfo;
  isAdmin: (req: Request) => boolean;
}) {
  const { app, admin, viewer, internal, channelInfo, isAdmin } = deps;
  const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

  const serialize = (r: NewsRow) => {
    const payload = JSON.parse(r.payload) as NewsPayload;
    const ch = channelInfo(r.channel_id);
    return {
      id: r.id,
      status: r.status,
      title: titleOf(payload),
      channelId: r.channel_id,
      channelName: ch.channelName,
      guildName: ch.guildName,
      // a link that opens the posted message in Discord
      messageUrl: r.message_id && ch.guildId ? `https://discord.com/channels/${ch.guildId}/${r.channel_id}/${r.message_id}` : null,
      payload,
      scheduledAt: r.scheduled_at,
      sentAt: r.sent_at,
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  };

  // ---------- default news channel ----------
  app.get('/api/news/settings', admin, (_req, res) => {
    const channelId = getSetting('news_channel_id');
    res.json({ channelId, ...(channelId ? channelInfo(channelId) : { channelName: null, guildName: null }) });
  });
  app.put('/api/news/settings', admin, (req, res) => {
    const b = z.object({ channelId: z.string().regex(/^\d{15,25}$/).nullable() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Неверный канал' });
    setSetting('news_channel_id', b.data.channelId);
    res.json({ channelId: b.data.channelId });
  });

  // ---------- images (uploaded in the editor, attached by the bot) ----------
  const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  app.post(
    '/api/news/images',
    admin,
    express.raw({ type: Object.keys(EXT), limit: '8mb' }),
    (req, res) => {
      const ext = EXT[String(req.headers['content-type'] ?? '').split(';')[0]];
      if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Загрузите картинку PNG, JPG, GIF или WebP до 8 МБ' });
      }
      const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(IMG_DIR, name), req.body);
      res.status(201).json({ name, url: `/api/news/images/${name}` });
    },
  );
  // public on purpose (the name is random and unguessable): the panel shows it in <img>
  app.get('/api/news/images/:name', (req, res) => {
    const name = String(req.params.name);
    if (!/^[a-f0-9]{24}\.(png|jpg|gif|webp)$/.test(name)) return res.status(404).end();
    const file = path.join(IMG_DIR, name);
    if (!fs.existsSync(file)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400').sendFile(file);
  });

  // ---------- CRUD ----------
  /** the public view of a posted news item: no channel ids, errors or schedule */
  const publicNews = (r: NewsRow) => {
    const full = serialize(r);
    return { id: full.id, status: full.status, title: full.title, payload: full.payload, sentAt: full.sentAt };
  };

  app.get('/api/news', viewer, (req, res) => {
    const rows = db.prepare('SELECT * FROM news ORDER BY COALESCE(scheduled_at, sent_at, created_at) DESC, id DESC').all() as NewsRow[];
    if (isAdmin(req)) return res.json(rows.map(serialize));
    res.json(rows.filter((r) => r.status === 'sent' || r.status === 'edit_queued').map(publicNews));
  });

  app.get('/api/news/:id', viewer, (req, res) => {
    const r = db.prepare('SELECT * FROM news WHERE id = ?').get(Number(req.params.id)) as NewsRow | undefined;
    if (!r || (!isAdmin(req) && r.status !== 'sent' && r.status !== 'edit_queued')) return res.status(404).json({ error: 'Новость не найдена' });
    res.json(isAdmin(req) ? serialize(r) : publicNews(r));
  });

  function statusFor(action: 'draft' | 'now' | 'schedule', at: number | undefined): { status: string; at: number | null; error?: string } {
    if (action === 'draft') return { status: 'draft', at: null };
    if (action === 'now') return { status: 'queued', at: null };
    if (!at || at < Date.now() - 60_000) return { status: 'draft', at: null, error: 'Укажите время публикации в будущем' };
    return { status: 'scheduled', at };
  }

  app.post(
    '/api/news',
    admin,
    wrap(async (req, res) => {
      const b = bodySchema.safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля' });
      const payload = tidy(b.data.payload);
      const bad = b.data.action !== 'draft' ? check(payload) : null;
      if (bad) return res.status(400).json({ error: bad });
      const st = statusFor(b.data.action, b.data.scheduledAt);
      if (st.error) return res.status(400).json({ error: st.error });
      const now = Date.now();
      const info = db
        .prepare('INSERT INTO news (status, channel_id, payload, scheduled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(st.status, b.data.channelId, JSON.stringify(payload), st.at, now, now);
      res.status(201).json(serialize(db.prepare('SELECT * FROM news WHERE id = ?').get(info.lastInsertRowid) as NewsRow));
    }),
  );

  app.put('/api/news/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const old = db.prepare('SELECT * FROM news WHERE id = ?').get(id) as NewsRow | undefined;
    if (!old) return res.status(404).json({ error: 'Новость не найдена' });
    const b = bodySchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля' });
    const payload = tidy(b.data.payload);
    const now = Date.now();

    if (old.status === 'sent' || old.status === 'edit_queued') {
      // an already posted message: only its content can change, the bot edits the message in place
      const bad = check(payload);
      if (bad) return res.status(400).json({ error: bad });
      db.prepare("UPDATE news SET payload = ?, status = 'edit_queued', error = NULL, updated_at = ? WHERE id = ?").run(JSON.stringify(payload), now, id);
    } else {
      if (['sending', 'delete_queued'].includes(old.status)) return res.status(409).json({ error: 'Новость сейчас отправляется, подождите несколько секунд' });
      const bad = b.data.action !== 'draft' ? check(payload) : null;
      if (bad) return res.status(400).json({ error: bad });
      const st = statusFor(b.data.action, b.data.scheduledAt);
      if (st.error) return res.status(400).json({ error: st.error });
      db.prepare('UPDATE news SET payload = ?, channel_id = ?, status = ?, scheduled_at = ?, error = NULL, updated_at = ? WHERE id = ?').run(
        JSON.stringify(payload),
        b.data.channelId,
        st.status,
        st.at,
        now,
        id,
      );
    }
    res.json(serialize(db.prepare('SELECT * FROM news WHERE id = ?').get(id) as NewsRow));
  });

  // publish a draft / scheduled / failed item right now
  app.post('/api/news/:id/publish', admin, (req, res) => {
    const id = Number(req.params.id);
    const r = db.prepare('SELECT * FROM news WHERE id = ?').get(id) as NewsRow | undefined;
    if (!r) return res.status(404).json({ error: 'Новость не найдена' });
    if (!['draft', 'scheduled', 'error'].includes(r.status)) return res.status(409).json({ error: 'Эта новость уже опубликована или отправляется' });
    const bad = check(JSON.parse(r.payload) as NewsPayload);
    if (bad) return res.status(400).json({ error: bad });
    db.prepare("UPDATE news SET status = 'queued', scheduled_at = NULL, error = NULL, updated_at = ? WHERE id = ?").run(Date.now(), id);
    res.json(serialize(db.prepare('SELECT * FROM news WHERE id = ?').get(id) as NewsRow));
  });

  app.delete('/api/news/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const r = db.prepare('SELECT * FROM news WHERE id = ?').get(id) as NewsRow | undefined;
    if (!r) return res.status(404).json({ error: 'Новость не найдена' });
    if (r.message_id && (r.status === 'sent' || r.status === 'edit_queued')) {
      // also remove the message from Discord; the row disappears once the bot confirms
      db.prepare("UPDATE news SET status = 'delete_queued', updated_at = ? WHERE id = ?").run(Date.now(), id);
      return res.json({ ok: true, pending: true });
    }
    db.prepare('DELETE FROM news WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------- internal: the bot ----------
  app.get('/internal/news/pending', internal, (_req, res) => {
    const now = Date.now();
    const rows = db
      .prepare(
        `SELECT * FROM news WHERE status IN ('queued','edit_queued','delete_queued')
           OR (status = 'scheduled' AND scheduled_at <= ?)
           OR (status = 'sending' AND updated_at < ?)`,
      )
      .all(now, now - 5 * 60_000) as NewsRow[];
    const claim = db.prepare("UPDATE news SET status = 'sending', updated_at = ? WHERE id = ?");
    const out = rows.map((r) => {
      const action = r.status === 'edit_queued' ? 'edit' : r.status === 'delete_queued' ? 'delete' : 'send';
      // claim sends so a slow bot cannot post the same news twice
      if (action === 'send') claim.run(now, r.id);
      return { id: r.id, action, channelId: r.channel_id, messageId: r.message_id, payload: JSON.parse(r.payload) as NewsPayload };
    });
    res.json(out);
  });

  app.patch('/internal/news/:id', internal, (req, res) => {
    const b = z
      .object({
        status: z.enum(['sent', 'error', 'deleted']),
        messageId: z.string().max(40).nullable().optional(),
        error: z.string().max(300).nullable().optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad body' });
    const id = Number(req.params.id);
    const now = Date.now();
    if (b.data.status === 'deleted') {
      db.prepare('DELETE FROM news WHERE id = ?').run(id);
    } else if (b.data.status === 'sent') {
      db.prepare("UPDATE news SET status = 'sent', message_id = COALESCE(?, message_id), sent_at = COALESCE(sent_at, ?), error = ?, updated_at = ? WHERE id = ?").run(
        b.data.messageId ?? null,
        now,
        b.data.error ?? null,
        now,
        id,
      );
    } else {
      // a failed edit/delete keeps the posted message ("sent"), a failed post becomes "error"
      const row = db.prepare('SELECT message_id FROM news WHERE id = ?').get(id) as { message_id: string | null } | undefined;
      db.prepare('UPDATE news SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(row?.message_id ? 'sent' : 'error', b.data.error ?? 'Ошибка отправки', now, id);
    }
    res.json({ ok: true });
  });
}
