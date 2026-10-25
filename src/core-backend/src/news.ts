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
import { commentCount } from './newsComments.js';
import { viewsOf } from './newsViews.js';
import { notifyNewsPublished } from './newsSubs.js';
import { db, getSetting, setSetting } from './db.js';
import { ledgerRecord, MAX_ATTEMPTS, planFailure, registerKind } from './deliveries.js';
import { gameProfile } from './games.js';
import { addColumn } from './schema.js';
import { param } from './http.js';

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

addColumn(db, 'news', 'repeat', "TEXT NOT NULL DEFAULT 'none'");
// delivery retries: failed attempts so far and the earliest time of the next one (see deliveries.ts)
addColumn(db, 'news', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
addColumn(db, 'news', 'next_try_at', 'INTEGER');
// a manual retry from the deliveries list puts the item back into the queue it came from
registerKind('news', {
  retry(refId, payload) {
    const q = payload.action === 'edit' ? 'edit_queued' : payload.action === 'delete' ? 'delete_queued' : 'queued';
    db.prepare("UPDATE news SET status = ?, attempts = 0, next_try_at = NULL, error = NULL, updated_at = ? WHERE id = ? AND test = 0").run(q, Date.now(), refId);
  },
});

// 1 = a test send (never shown in lists, cleaned up after an hour)
addColumn(db, 'news', 'test', 'INTEGER NOT NULL DEFAULT 0');

// the user who created the item (its role is resolved at read time, see authorRole)
addColumn(db, 'news', 'created_by', 'INTEGER');

db.exec(`
CREATE TABLE IF NOT EXISTS news_reactions (
  news_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (news_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_news_reactions_news ON news_reactions (news_id);
CREATE TABLE IF NOT EXISTS news_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  news_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  payload TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_news_versions_news ON news_versions (news_id, id);
CREATE TABLE IF NOT EXISTS news_autosave (
  user_key TEXT NOT NULL,
  key TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_key, key)
);
`);

interface NewsRow {
  repeat: string;
  id: number;
  test?: number;
  status: string;
  channel_id: string;
  payload: string;
  scheduled_at: number | null;
  sent_at: number | null;
  message_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  created_by?: number | null;
}

// ---------- validation (Discord limits) ----------
const link = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Ссылка должна начинаться с http:// или https://');

/** links of the site-only fields: https only (an empty string means "none") */
const httpsLink = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === '' || /^https:\/\/\S+$/i.test(v), 'Ссылка должна начинаться с https://');
const UPLOAD_RE = /^[a-f0-9]{24}\.(png|jpg|gif|webp)$/;
export const NEWS_CATEGORIES = ['announcement', 'wipe', 'update', 'event', 'maintenance', 'other'] as const;
/** reactions players can leave on a published item (the heart carries the emoji variation selector) */
export const NEWS_REACTIONS = ['👍', '🔥', '\u2764\uFE0F', '😮'] as const;

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
  // more embeds in the same message (Discord: 10 embeds in total)
  extraEmbeds: z.array(embedSchema).max(9, 'Дополнительных embed не больше 9').optional(),
  // live status cards of these servers are appended to the message at send time
  statusServerIds: z.array(z.number().int().positive()).max(5, 'Статусов серверов не больше 5').optional(),
  // ---- site-only fields (ignored by Discord, except `actions` which become link buttons) ----
  category: z.enum(NEWS_CATEGORIES).optional(),
  pinned: z.boolean().optional(),
  game: z
    .string()
    .trim()
    .max(40)
    .refine((v) => v === '' || !!gameProfile(v), 'Неизвестная игра')
    .optional(),
  gallery: z
    .array(z.object({ url: httpsLink.optional(), upload: z.string().regex(UPLOAD_RE).optional() }))
    .max(6, 'В галерее не больше 6 картинок')
    .optional(),
  changes: z
    .array(
      z.object({
        kind: z.enum(['add', 'fix', 'remove', 'change']),
        text: z.string().trim().min(1, 'Текст изменения не может быть пустым').max(200, 'Изменение: не более 200 символов'),
      }),
    )
    .max(20, 'Изменений не больше 20')
    .optional(),
  countdownAt: z.number().int().min(0).optional(),
  countdownLabel: z.string().trim().max(60, 'Подпись таймера: не более 60 символов').optional(),
  actions: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'У кнопки должна быть подпись').max(40, 'Подпись кнопки: не более 40 символов'),
        url: httpsLink.refine((v) => v !== '', 'У кнопки должна быть ссылка'),
      }),
    )
    .max(3, 'Кнопок не больше 3')
    .optional(),
});

type EmbedIn = z.infer<typeof embedSchema>;
export type NewsPayload = z.infer<typeof payloadSchema>;

const bodySchema = z.object({
  channelId: z.string().regex(/^\d{15,25}$/, 'Выберите канал для новости'),
  payload: payloadSchema,
  action: z.enum(['draft', 'now', 'schedule']),
  scheduledAt: z.number().int().optional(),
  // a scheduled item can repeat: after it is posted the next one is scheduled
  repeat: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
});

/** Drops empty strings, so "no title" is really absent. */
function tidyEmbed(e: EmbedIn | undefined): EmbedIn | undefined {
  if (!e) return undefined;
  const out = { ...e };
  for (const k of ['title', 'url', 'description', 'thumbnailUrl'] as const) if (!out[k]?.trim()) delete out[k];
  if (out.author && !out.author.name.trim()) delete out.author;
  else if (out.author && !out.author.iconUrl) out.author = { name: out.author.name };
  if (out.footer && !out.footer.text.trim()) delete out.footer;
  if (out.image && !out.image.url && !out.image.upload) delete out.image;
  else if (out.image && !out.image.url) out.image = { upload: out.image.upload };
  if (!out.fields?.length) delete out.fields;
  const hasEmbed = Object.keys(out).some((k) => k !== 'color' && k !== 'timestamp') || (out.timestamp && Object.keys(out).length > 1);
  return hasEmbed ? out : undefined;
}

function tidy(p: NewsPayload): NewsPayload {
  const extra = (p.extraEmbeds ?? []).map(tidyEmbed).filter((e): e is EmbedIn => !!e);
  const ids = [...new Set(p.statusServerIds ?? [])];
  const gallery = (p.gallery ?? []).filter((g) => g.url || g.upload).map((g) => (g.upload ? { upload: g.upload } : { url: g.url }));
  const out: NewsPayload = {
    ...p,
    embed: tidyEmbed(p.embed),
    extraEmbeds: extra.length ? extra : undefined,
    statusServerIds: ids.length ? ids : undefined,
    gallery: gallery.length ? gallery : undefined,
    changes: p.changes?.length ? p.changes : undefined,
    actions: p.actions?.length ? p.actions : undefined,
    game: p.game || undefined,
    countdownLabel: p.countdownLabel || undefined,
  };
  if (!out.pinned) delete out.pinned;
  if (!out.countdownAt) {
    delete out.countdownAt;
    delete out.countdownLabel;
  }
  for (const k of Object.keys(out) as (keyof NewsPayload)[]) if (out[k] === undefined) delete out[k];
  return out;
}

const allEmbeds = (p: NewsPayload): EmbedIn[] => [...(p.embed ? [p.embed] : []), ...(p.extraEmbeds ?? [])];

interface PlainEmbed {
  title?: string;
  description?: string;
  author?: { name: string };
  footer?: { text: string };
  fields?: { name: string; value: string }[];
}
function embedLength(e: PlainEmbed): number {
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
  const embeds = allEmbeds(p);
  if (!p.content.trim() && !embeds.length && !p.statusServerIds?.length) return 'Напишите текст или заполните embed: пустое сообщение отправить нельзя';
  if (embeds.length > 10) return 'В сообщении не больше 10 embed';
  for (const e of embeds) if (embedLength(e) > 6000) return 'Embed длиннее 6000 символов (лимит Discord): сократите текст';
  if (embeds.reduce((n, e) => n + embedLength(e), 0) > 6000) return 'Все embed вместе длиннее 6000 символов (лимит Discord): сократите текст';
  return null;
}

const titleOf = (p: NewsPayload) => p.embed?.title?.trim() || p.content.trim().slice(0, 70) || p.embed?.description?.trim().slice(0, 70) || 'Без названия';

/** the next time a repeating item should go out, always in the future */
function nextOccurrence(from: number, repeat: string, now: number): number {
  const d = new Date(from);
  let guard = 0;
  do {
    if (repeat === 'daily') d.setUTCDate(d.getUTCDate() + 1);
    else if (repeat === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  } while (d.getTime() <= now && ++guard < 1000);
  return d.getTime();
}

export interface NewsServerInfo {
  id: number;
  name: string;
  players: number;
  maxPlayers: number;
  online: boolean;
  address: string;
  map: string | null;
  ping: number | null;
}
export interface StatusEmbed {
  title?: string;
  description?: string;
  author?: { name: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string; icon_url?: string };
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type ChannelInfo = (id: string) => { channelName: string | null; guildName: string | null; guildId: string | null };

export function registerNews(deps: {
  app: express.Express;
  /** administrators and moderators: everything that writes news */
  staff: RequestHandler;
  viewer: RequestHandler;
  internal: RequestHandler;
  channelInfo: ChannelInfo;
  /** the signed-in user is an administrator or a moderator */
  isStaff: (req: Request) => boolean;
  /** any signed-in user (reactions); without it the reaction route falls back to staff */
  auth?: RequestHandler;
  /** every server with its current status (for variables) */
  servers: () => NewsServerInfo[];
  /** the status card of a server (the one the bot posts), or null */
  statusEmbed: (serverId: number) => StatusEmbed | null;
  /** public https address of the panel (for the «read in full» link), or null when unknown */
  publicBase: () => string | null;
  /** may guests look at the panel (the link preview page is public only then) */
  publicPanel?: () => boolean;
  /** the address the request came to, when the public one is not set */
  baseOf?: (req: Request) => string;
  /** name and colour of the site for the preview page */
  brand?: () => { name: string; color: string };
}) {
  const { app, staff, viewer, internal, channelInfo, isStaff: isAdmin, servers, statusEmbed } = deps;
  const authed = deps.auth ?? staff;
  const uidOf = (req: Request) => (req as Request & { user?: { id?: number } }).user?.id ?? null;
  const actorOf = (req: Request) => (req as Request & { user?: { username?: string } }).user?.username ?? '—';
  const userKeyOf = (req: Request) => {
    const u = (req as Request & { user?: { id?: number; username?: string } }).user;
    return String(u?.id ?? u?.username ?? 'anon');
  };

  // ---------- version history ----------
  const insertVersion = db.prepare('INSERT INTO news_versions (news_id, ts, actor, payload, note) VALUES (?, ?, ?, ?, ?)');
  function addVersion(newsId: number, payloadJson: string, actor: string, note: string) {
    insertVersion.run(newsId, Date.now(), actor, payloadJson, note);
    db.prepare(
      'DELETE FROM news_versions WHERE news_id = ? AND id NOT IN (SELECT id FROM news_versions WHERE news_id = ? ORDER BY id DESC LIMIT 30)',
    ).run(newsId, newsId);
  }

  // ---------- variables ----------
  const TZ = () => getSetting('timezone') || process.env.TZ || 'Europe/Moscow';
  const SERVER_FIELDS: [string, string][] = [
    ['name', 'название'],
    ['players', 'игроков сейчас'],
    ['max', 'максимум игроков'],
    ['online', 'состояние (онлайн/офлайн)'],
    ['address', 'адрес'],
    ['map', 'текущая карта'],
    ['ping', 'пинг, мс'],
  ];
  function variableList() {
    const out: { token: string; description: string }[] = [
      { token: '{players}', description: 'Всего игроков онлайн на всех серверах' },
      { token: '{online}', description: 'Сколько серверов сейчас онлайн' },
      { token: '{servers}', description: 'Сколько всего серверов' },
      { token: '{date}', description: 'Текущая дата (по часовому поясу панели)' },
      { token: '{time}', description: 'Текущее время (по часовому поясу панели)' },
    ];
    for (const s of servers()) for (const [f, d] of SERVER_FIELDS) out.push({ token: `{server.${s.id}.${f}}`, description: `${s.name}: ${d}` });
    return out;
  }
  function makeResolver() {
    const list = servers();
    const byId = new Map(list.map((s) => [s.id, s]));
    const tz = TZ();
    const now = new Date();
    const fmt = (o: Intl.DateTimeFormatOptions) => {
      try {
        return now.toLocaleString('ru-RU', { ...o, timeZone: tz });
      } catch {
        return now.toLocaleString('ru-RU', o);
      }
    };
    const lookup = (key: string): string | null => {
      switch (key) {
        case 'players':
          return String(list.filter((s) => s.online).reduce((n, s) => n + s.players, 0));
        case 'online':
          return String(list.filter((s) => s.online).length);
        case 'servers':
          return String(list.length);
        case 'date':
          return fmt({ day: '2-digit', month: '2-digit', year: 'numeric' });
        case 'time':
          return fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
      }
      const m = /^server\.(\d+)\.(name|players|max|online|address|map|ping)$/.exec(key);
      if (!m) return null;
      const s = byId.get(Number(m[1]));
      if (!s) return null;
      switch (m[2]) {
        case 'name':
          return s.name;
        case 'players':
          return String(s.online ? s.players : 0);
        case 'max':
          return String(s.maxPlayers);
        case 'online':
          return s.online ? 'онлайн' : 'офлайн';
        case 'address':
          return s.address;
        case 'map':
          return s.map || '—';
        default:
          return s.ping != null ? String(s.ping) : '—';
      }
    };
    return (text: string) => text.replace(/\{([A-Za-z0-9_.]+)\}/g, (all, k: string) => lookup(k) ?? all);
  }

  /** the payload as it goes to Discord: variables substituted, status cards appended */
  function resolvePayload(p: NewsPayload, test: boolean, newsId?: number) {
    const r = makeResolver();
    const embed = (e: EmbedIn): EmbedIn => ({
      ...e,
      ...(e.title ? { title: cut(r(e.title), 256) } : {}),
      ...(e.description ? { description: cut(r(e.description), 4096) } : {}),
      ...(e.author ? { author: { ...e.author, name: cut(r(e.author.name), 256) } } : {}),
      ...(e.footer ? { footer: { text: cut(r(e.footer.text), 2048) } } : {}),
      ...(e.fields ? { fields: e.fields.map((f) => ({ ...f, name: cut(r(f.name), 256), value: cut(r(f.value), 1024) })) } : {}),
    });
    let content = cut(r(p.content ?? ''), 2000);
    let mention = p.mention;
    // a mention typed into the text counts as the choice "ping" (an embed alone never pings)
    if (mention === 'none') {
      const typed = [content, ...[p.embed, ...(p.extraEmbeds ?? [])].map((e) => e?.description ?? '')].join('\n');
      if (/(^|[^\w])@everyone\b/.test(typed)) mention = 'everyone';
      else if (/(^|[^\w])@here\b/.test(typed)) mention = 'here';
    }
    if (test) {
      mention = 'none';
      content = cut(`[ТЕСТ]${content.trim() ? ` ${content}` : ''}`, 2000);
    }
    const out: NewsPayload = { content, mention, ...(p.embed ? { embed: embed(p.embed) } : {}) };
    if (p.extraEmbeds?.length) out.extraEmbeds = p.extraEmbeds.map(embed);
    // link buttons under the message; the first one always opens the full version in the panel (a short /go/ link)
    const base = deps.publicBase();
    const full = base && newsId && !test ? `${base}/go/news/${newsId}` : null;
    if (full) {
      // the title becomes a link too, unless the author set their own
      if (out.embed?.title && !out.embed.url) out.embed.url = full;
      out.actions = [{ label: 'Читать полностью', url: full }, ...(p.actions ?? []).slice(0, 2)];
    } else if (p.actions?.length) out.actions = p.actions;
    // status cards: they never push the message over 10 embeds or 6000 characters
    const statusEmbeds: StatusEmbed[] = [];
    const used = allEmbeds(out);
    let room = 10 - used.length;
    let len = used.reduce((n, e) => n + embedLength(e), 0);
    for (const id of p.statusServerIds ?? []) {
      if (room <= 0) break;
      const e = statusEmbed(id);
      if (!e) continue;
      const clean: StatusEmbed = { ...e };
      delete clean.footer;
      const l = embedLength(clean);
      if (len + l > 6000) continue;
      len += l;
      room--;
      statusEmbeds.push(clean);
    }
    return { payload: out, statusEmbeds };
  }
  const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

  // ---------- reactions, author role ----------
  const isReaction = (e: string) => (NEWS_REACTIONS as readonly string[]).includes(e);
  /** accepts the heart with or without the variation selector */
  const canonEmoji = (e: string) => (e === '\u2764' ? '\u2764\uFE0F' : e);
  const reactionRows = db.prepare('SELECT emoji, COUNT(*) AS n FROM news_reactions WHERE news_id = ? GROUP BY emoji');
  const myReaction = db.prepare('SELECT emoji FROM news_reactions WHERE news_id = ? AND user_id = ?');
  function reactionsOf(newsId: number, uid: number | null) {
    const counts = new Map((reactionRows.all(newsId) as { emoji: string; n: number }[]).map((x) => [x.emoji, x.n]));
    const mine = uid != null ? (myReaction.get(newsId, uid) as { emoji: string } | undefined)?.emoji : undefined;
    return NEWS_REACTIONS.filter((e) => (counts.get(e) ?? 0) > 0).map((e) => ({ emoji: e as string, count: counts.get(e)!, mine: mine === e }));
  }
  const roleOf = db.prepare('SELECT role FROM users WHERE id = ?');
  function authorRoleOf(r: NewsRow): 'admin' | 'moderator' | 'player' | null {
    if (r.created_by == null) return null;
    const u = roleOf.get(r.created_by) as { role: string } | undefined;
    return u && (u.role === 'admin' || u.role === 'moderator' || u.role === 'player') ? u.role : null;
  }

  const serialize = (r: NewsRow, uid: number | null = null) => {
    const payload = JSON.parse(r.payload) as NewsPayload;
    const ch = channelInfo(r.channel_id);
    return {
      category: payload.category ?? 'announcement',
      pinned: !!payload.pinned,
      authorRole: authorRoleOf(r),
      reactions: reactionsOf(r.id, uid),
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
      repeat: r.repeat,
      sentAt: r.sent_at,
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  };

  // ---------- default news channel ----------
  app.get('/api/news/settings', staff, (_req, res) => {
    const channelId = getSetting('news_channel_id');
    const testChannelId = getSetting('news_test_channel_id') ?? '';
    const tc = testChannelId ? channelInfo(testChannelId) : null;
    res.json({
      channelId,
      ...(channelId ? channelInfo(channelId) : { channelName: null, guildName: null }),
      testChannelId,
      testChannelName: tc?.channelName ?? null,
      testGuildName: tc?.guildName ?? null,
    });
  });
  app.put('/api/news/settings', staff, (req, res) => {
    const b = z
      .object({
        channelId: z.string().regex(/^\d{15,25}$/).nullable().optional(),
        testChannelId: z.union([z.string().regex(/^\d{15,25}$/), z.literal('')]).optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Неверный канал' });
    if (b.data.channelId !== undefined) setSetting('news_channel_id', b.data.channelId);
    if (b.data.testChannelId !== undefined) setSetting('news_test_channel_id', b.data.testChannelId || null);
    res.json({ channelId: getSetting('news_channel_id'), testChannelId: getSetting('news_test_channel_id') ?? '' });
  });

  // ---------- variables, test send, autosave (fixed paths: must come before /api/news/:id) ----------
  app.get('/api/news/variables', staff, (_req, res) => {
    res.json(variableList());
  });

  app.post('/api/news/test', staff, (req, res) => {
    const b = z
      .object({ payload: payloadSchema, channelId: z.string().regex(/^\d{15,25}$/, 'Неверный канал').optional() })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля' });
    const payload = tidy(b.data.payload);
    const bad = check(payload);
    if (bad) return res.status(400).json({ error: bad });
    const channelId = b.data.channelId || getSetting('news_test_channel_id');
    if (!channelId) return res.status(400).json({ error: 'Не задан тестовый канал: выберите его в настройках новостей' });
    const now = Date.now();
    const info = db
      .prepare("INSERT INTO news (status, channel_id, payload, test, created_at, updated_at) VALUES ('queued', ?, ?, 1, ?, ?)")
      .run(channelId, JSON.stringify(payload), now, now);
    res.json({ ok: true, testId: Number(info.lastInsertRowid) });
  });

  // the outcome of a test send (the bot picks it up within a few seconds)
  app.get('/api/news/test/:id', staff, (req, res) => {
    const r = db.prepare('SELECT status, error FROM news WHERE id = ? AND test = 1').get(Number(req.params.id)) as { status: string; error: string | null } | undefined;
    if (!r) return res.status(404).json({ error: 'Тест не найден' });
    res.json({ status: r.status === 'test_sent' ? 'sent' : r.status === 'test_error' ? 'error' : 'pending', error: r.error });
  });

  const autosaveKey = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);
  app.put('/api/news/autosave', staff, (req, res) => {
    const b = z.object({ key: autosaveKey, payload: z.record(z.string(), z.unknown()) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Неверные данные черновика' });
    const json = JSON.stringify(b.data.payload);
    if (json.length > 400_000) return res.status(413).json({ error: 'Черновик слишком большой' });
    const now = Date.now();
    db.prepare(
      'INSERT INTO news_autosave (user_key, key, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_key, key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
    ).run(userKeyOf(req), b.data.key, json, now);
    // forget abandoned drafts after 30 days
    db.prepare('DELETE FROM news_autosave WHERE updated_at < ?').run(now - 30 * 86400_000);
    res.json({ ok: true, updatedAt: now });
  });
  app.get('/api/news/autosave', staff, (req, res) => {
    const k = autosaveKey.safeParse(req.query.key);
    if (!k.success) return res.status(400).json({ error: 'Укажите key' });
    const r = db.prepare('SELECT payload, updated_at FROM news_autosave WHERE user_key = ? AND key = ?').get(userKeyOf(req), k.data) as
      | { payload: string; updated_at: number }
      | undefined;
    if (!r) return res.json({ payload: null, updatedAt: null });
    res.json({ payload: JSON.parse(r.payload), updatedAt: r.updated_at });
  });
  app.delete('/api/news/autosave', staff, (req, res) => {
    const k = autosaveKey.safeParse(req.query.key ?? req.body?.key);
    if (!k.success) return res.status(400).json({ error: 'Укажите key' });
    db.prepare('DELETE FROM news_autosave WHERE user_key = ? AND key = ?').run(userKeyOf(req), k.data);
    res.json({ ok: true });
  });

  // ---------- images (uploaded in the editor, attached by the bot) ----------
  const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  app.post(
    '/api/news/images',
    staff,
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
  const publicNews = (r: NewsRow, uid: number | null) => {
    const full = serialize(r, uid);
    return {
      id: full.id,
      status: full.status,
      title: full.title,
      payload: full.payload,
      sentAt: full.sentAt,
      category: full.category,
      pinned: full.pinned,
      authorRole: full.authorRole,
      reactions: full.reactions,
      comments: commentCount(full.id),
      views: viewsOf(full.id),
    };
  };
  const isPublished = (r: { status: string }) => r.status === 'sent' || r.status === 'edit_queued';
  const pinnedOf = (r: NewsRow) => {
    try {
      return !!(JSON.parse(r.payload) as NewsPayload).pinned;
    } catch {
      return false;
    }
  };
  /** the order of published items by time, newest first */
  const byTime = (a: NewsRow, b: NewsRow) => (b.sent_at ?? b.created_at) - (a.sent_at ?? a.created_at) || b.id - a.id;

  /** ?limit=N&offset=M: a page of the list (without limit: everything, as before) */
  const pageOf = <T,>(list: T[], req: Request): T[] => {
    const limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1) return list;
    const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
    return list.slice(offset, offset + Math.min(100, limit));
  };
  const PUBLISHED_SQL = "status IN ('sent','edit_queued')";
  const totals = (sql: string) => new Map((db.prepare(sql).all() as { id: number; n: number }[]).map((r) => [r.id, r.n]));
  const reactionTotals = () => totals('SELECT news_id AS id, COUNT(*) AS n FROM news_reactions GROUP BY news_id');
  const commentTotals = () => totals("SELECT news_id AS id, COUNT(*) AS n FROM news_comments WHERE status = 'visible' GROUP BY news_id");
  const viewTotals = () => totals('SELECT news_id AS id, SUM(n) AS n FROM news_views GROUP BY news_id');

  app.get('/api/news', viewer, (req, res) => {
    const uid = uidOf(req);
    if (isAdmin(req)) {
      const rows = db.prepare('SELECT * FROM news WHERE test = 0 ORDER BY COALESCE(scheduled_at, sent_at, created_at) DESC, id DESC').all() as NewsRow[];
      return res.json(pageOf(rows, req).map((r) => serialize(r, uid)));
    }
    // only the published rows are read, and only the requested page is turned into the public shape (reactions are a query each)
    const cat = typeof req.query.category === 'string' && (NEWS_CATEGORIES as readonly string[]).includes(req.query.category) ? req.query.category : '';
    const author = Number(req.query.author);
    const byAuthor = Number.isInteger(author) && author > 0;
    const rows = db.prepare(`SELECT * FROM news WHERE test = 0 AND ${PUBLISHED_SQL}${cat ? " AND COALESCE(json_extract(payload, '$.category'), 'announcement') = ?" : ''}${byAuthor ? ' AND created_by = ?' : ''}`).all(...(cat ? [cat] : []), ...(byAuthor ? [author] : [])) as NewsRow[];
    // ?sort=top (most reactions) / discussed (most comments) / viewed (most views): by that number, then the newest; without it: pinned first, then the newest
    const sort = req.query.sort;
    const score = sort === 'top' ? reactionTotals() : sort === 'discussed' ? commentTotals() : sort === 'viewed' ? viewTotals() : null;
    const pub = rows.sort((a, b) => (score ? (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) : Number(pinnedOf(b)) - Number(pinnedOf(a))) || byTime(a, b));
    res.json(pageOf(pub, req).map((r) => publicNews(r, uid)));
  });

  /** how many published items every rubric has (the chips of the news page; a page of the list cannot tell) */
  app.get('/api/news/counts', viewer, (_req, res) => {
    const out: Record<string, number> = { all: 0 };
    for (const c of NEWS_CATEGORIES) out[c] = 0;
    const rows = db.prepare(`SELECT COALESCE(json_extract(payload, '$.category'), 'announcement') AS cat, COUNT(*) AS n FROM news WHERE test = 0 AND ${PUBLISHED_SQL} GROUP BY cat`).all() as { cat: string; n: number }[];
    for (const r of rows) {
      const k = (NEWS_CATEGORIES as readonly string[]).includes(r.cat) ? r.cat : 'announcement';
      out[k] += r.n;
      out.all += r.n;
    }
    res.json(out);
  });

  app.get('/api/news/:id', viewer, (req, res) => {
    const uid = uidOf(req);
    const r = db.prepare('SELECT * FROM news WHERE id = ? AND test = 0').get(Number(req.params.id)) as NewsRow | undefined;
    if (!r || (!isAdmin(req) && !isPublished(r))) return res.status(404).json({ error: 'Новость не найдена' });
    const base = isAdmin(req) ? serialize(r, uid) : publicNews(r, uid);
    // neighbours among published items: prev is the one before it in the list (newer), next the one after (older).
    // Only ids (and the rubric) are read for the whole list; the two neighbours and the suggestions are loaded by id.
    const order = db
      .prepare(`SELECT id, COALESCE(json_extract(payload, '$.category'), 'announcement') AS cat FROM news WHERE test = 0 AND ${PUBLISHED_SQL} ORDER BY COALESCE(sent_at, created_at) DESC, id DESC`)
      .all() as { id: number; cat: string }[];
    const i = order.findIndex((x) => x.id === r.id);
    const byId = db.prepare('SELECT * FROM news WHERE id = ?');
    const ref = (x: { id: number } | undefined) => {
      const row = x ? (byId.get(x.id) as NewsRow | undefined) : undefined;
      return row ? { id: row.id, title: titleOf(JSON.parse(row.payload) as NewsPayload) } : null;
    };
    // «Read next»: the same rubric first, then the newest ones, never this item
    const mine = i >= 0 ? order[i].cat : 'announcement';
    const others = order.filter((x) => x.id !== r.id);
    const suggested = [...others.filter((x) => x.cat === mine), ...others.filter((x) => x.cat !== mine)].slice(0, 3);
    const related = suggested.map((x) => byId.get(x.id) as NewsRow | undefined).filter((x): x is NewsRow => !!x).map((x) => publicNews(x, uid));
    // the last edit made after the publication (pinning does not count): «Обновлено …» under the headline
    const ed = r.sent_at
      ? (db.prepare("SELECT MAX(ts) AS ts, COUNT(*) AS n FROM news_versions WHERE news_id = ? AND ts > ? AND note NOT IN ('Закреплено', 'Откреплено')").get(r.id, r.sent_at) as { ts: number | null; n: number })
      : { ts: null, n: 0 };
    // «Кто писал»: how many items the author has published, and the id for the filter ?author=
    const authorCount = r.created_by == null ? 0 : (db.prepare(`SELECT COUNT(*) AS n FROM news WHERE test = 0 AND created_by = ? AND ${PUBLISHED_SQL}`).get(r.created_by) as { n: number }).n;
    res.json({ ...base, authorId: r.created_by ?? null, authorCount, editedAt: ed.ts, edits: ed.n, prev: i > 0 ? ref(order[i - 1]) : null, next: i >= 0 ? ref(order[i + 1]) : null, related });
  });

  // ---------- a link that looks good when pasted into Discord/Telegram: /n/<id> (redirects to the news page) ----------
  const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  /** a plain teaser out of Discord markdown */
  const teaser = (text: string, max = 200) => {
    const t = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^[ \t]*[-*•]\s+/gm, '• ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_~`>#|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  };
  /** the picture of a news item for the preview: its image, else the first gallery picture, else the default one */
  const previewImage = (p: NewsPayload, base: string): string => {
    const e = p.embed;
    if (e?.image?.upload) return `${base}/api/news/images/${e.image.upload}`;
    if (e?.image?.url && /^https:\/\//i.test(e.image.url)) return e.image.url;
    const g = p.gallery?.find((x) => x.upload || (x.url && /^https:\/\//i.test(x.url)));
    if (g?.upload) return `${base}/api/news/images/${g.upload}`;
    if (g?.url) return g.url;
    return `${base}/og-default.png`;
  };
  app.get('/n/:id', param('id'), (req, res) => {
    res.set({ 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' });
    const gone = () => void res.status(404).type('html').send('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Не найдено</title></head><body><p>Новость не найдена.</p></body></html>');
    if (deps.publicPanel && !deps.publicPanel()) return gone();
    const r = db.prepare('SELECT * FROM news WHERE id = ? AND test = 0').get(Number(req.params.id)) as NewsRow | undefined;
    if (!r || !isPublished(r)) return gone();
    const p = JSON.parse(r.payload) as NewsPayload;
    const base = deps.publicBase() ?? deps.baseOf?.(req) ?? `${req.protocol}://${req.get('host')}`;
    const b = deps.brand?.() ?? { name: 'CoreGSM', color: '#4f46e5' };
    const title = titleOf(p);
    const desc = teaser(p.embed?.description || p.content || '') || b.name;
    const target = `/news/${r.id}`;
    const url = `${base}/n/${r.id}`;
    const image = previewImage(p, base);
    res.type('html').send(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(b.name)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="${esc(b.color)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(b.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="ru_RU">
${r.sent_at ? `<meta property="article:published_time" content="${new Date(r.sent_at).toISOString()}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<script>location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')});</script>
</head>
<body>
<p><a href="${esc(target)}">${esc(title)}</a></p>
</body>
</html>`);
  });

  // a signed-in user's single reaction on a published item
  const reactHits = new Map<number, { n: number; reset: number }>();
  app.put('/api/news/:id/reaction', authed, (req, res) => {
    const uid = uidOf(req);
    if (uid == null) return res.status(401).json({ error: 'Требуется вход' });
    const now = Date.now();
    const h = reactHits.get(uid);
    if (!h || h.reset <= now) reactHits.set(uid, { n: 1, reset: now + 60_000 });
    else if (++h.n > 30) {
      const retryAfter = Math.max(1, Math.ceil((h.reset - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Слишком много реакций. Подождите минуту.', retryAfter });
    }
    const b = z.object({ emoji: z.string().nullable() }).safeParse(req.body);
    const emoji = b.success && b.data.emoji !== null ? canonEmoji(b.data.emoji) : null;
    if (!b.success || (emoji !== null && !isReaction(emoji))) return res.status(400).json({ error: 'Неверная реакция' });
    const id = Number(req.params.id);
    const r = db.prepare('SELECT * FROM news WHERE id = ? AND test = 0').get(id) as NewsRow | undefined;
    if (!r || !isPublished(r)) return res.status(404).json({ error: 'Новость не найдена' });
    if (emoji === null) db.prepare('DELETE FROM news_reactions WHERE news_id = ? AND user_id = ?').run(id, uid);
    else {
      db.prepare(
        'INSERT INTO news_reactions (news_id, user_id, emoji, ts) VALUES (?, ?, ?, ?) ON CONFLICT(news_id, user_id) DO UPDATE SET emoji = excluded.emoji, ts = excluded.ts',
      ).run(id, uid, emoji, now);
    }
    res.json(reactionsOf(id, uid));
  });

  // pin / unpin (staff); site-only, nothing changes in Discord
  app.patch('/api/news/:id/pin', staff, (req, res) => {
    const id = Number(req.params.id);
    const item = loadItem(id);
    if (!item) return res.status(404).json({ error: 'Новость не найдена' });
    const b = z.object({ pinned: z.boolean() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Укажите pinned: true или false' });
    const p = JSON.parse(item.payload) as NewsPayload;
    if (b.data.pinned) p.pinned = true;
    else delete p.pinned;
    const json = JSON.stringify(p);
    db.prepare('UPDATE news SET payload = ?, updated_at = ? WHERE id = ?').run(json, Date.now(), id);
    addVersion(id, json, actorOf(req), b.data.pinned ? 'Закреплено' : 'Откреплено');
    res.json(serialize(loadItem(id)!, uidOf(req)));
  });

  function statusFor(action: 'draft' | 'now' | 'schedule', at: number | undefined): { status: string; at: number | null; error?: string } {
    if (action === 'draft') return { status: 'draft', at: null };
    if (action === 'now') return { status: 'queued', at: null };
    if (!at || at < Date.now() - 60_000) return { status: 'draft', at: null, error: 'Укажите время публикации в будущем' };
    return { status: 'scheduled', at };
  }

  app.post(
    '/api/news',
    staff,
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
        .prepare('INSERT INTO news (status, channel_id, payload, scheduled_at, repeat, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(st.status, b.data.channelId, JSON.stringify(payload), st.at, st.status === 'scheduled' ? (b.data.repeat ?? 'none') : 'none', now, now, uidOf(req));
      addVersion(Number(info.lastInsertRowid), JSON.stringify(payload), actorOf(req), 'Создано');
      res.status(201).json(serialize(db.prepare('SELECT * FROM news WHERE id = ?').get(info.lastInsertRowid) as NewsRow));
    }),
  );

  app.put('/api/news/:id', staff, (req, res) => {
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
      db.prepare('UPDATE news SET payload = ?, channel_id = ?, status = ?, scheduled_at = ?, repeat = ?, error = NULL, updated_at = ? WHERE id = ?').run(
        JSON.stringify(payload),
        b.data.channelId,
        st.status,
        st.at,
        st.status === 'scheduled' ? (b.data.repeat ?? 'none') : 'none',
        now,
        id,
      );
    }
    const posted = old.status === 'sent' || old.status === 'edit_queued';
    addVersion(id, JSON.stringify(payload), actorOf(req), posted ? 'Изменено после публикации' : 'Сохранено');
    res.json(serialize(db.prepare('SELECT * FROM news WHERE id = ?').get(id) as NewsRow));
  });

  // ---------- versions, history, duplicate, reschedule ----------
  const loadItem = (id: number) => db.prepare('SELECT * FROM news WHERE id = ? AND test = 0').get(id) as NewsRow | undefined;

  app.get('/api/news/:id/versions', staff, (req, res) => {
    const id = Number(req.params.id);
    if (!loadItem(id)) return res.status(404).json({ error: 'Новость не найдена' });
    const rows = db.prepare('SELECT id, ts, actor, note FROM news_versions WHERE news_id = ? ORDER BY id DESC').all(id);
    res.json(rows);
  });

  app.get('/api/news/:id/versions/:vid', staff, (req, res) => {
    const r = db
      .prepare('SELECT id, ts, actor, payload, note FROM news_versions WHERE id = ? AND news_id = ?')
      .get(Number(req.params.vid), Number(req.params.id)) as { id: number; ts: number; actor: string; payload: string; note: string } | undefined;
    if (!r) return res.status(404).json({ error: 'Версия не найдена' });
    res.json({ id: r.id, ts: r.ts, actor: r.actor, note: r.note, payload: JSON.parse(r.payload) });
  });

  app.post('/api/news/:id/versions/:vid/restore', staff, (req, res) => {
    const id = Number(req.params.id);
    const item = loadItem(id);
    if (!item) return res.status(404).json({ error: 'Новость не найдена' });
    const v = db
      .prepare('SELECT id, payload FROM news_versions WHERE id = ? AND news_id = ?')
      .get(Number(req.params.vid), id) as { id: number; payload: string } | undefined;
    if (!v) return res.status(404).json({ error: 'Версия не найдена' });
    if (['sending', 'delete_queued'].includes(item.status)) return res.status(409).json({ error: 'Новость сейчас отправляется, подождите несколько секунд' });
    const parsed = payloadSchema.safeParse(JSON.parse(v.payload));
    if (!parsed.success) return res.status(400).json({ error: 'Эту версию нельзя восстановить: ' + (parsed.error.issues[0]?.message ?? 'неверные данные') });
    const payload = tidy(parsed.data);
    const posted = item.status === 'sent' || item.status === 'edit_queued';
    if (posted) {
      const bad = check(payload);
      if (bad) return res.status(400).json({ error: bad });
      db.prepare("UPDATE news SET payload = ?, status = 'edit_queued', error = NULL, updated_at = ? WHERE id = ?").run(JSON.stringify(payload), Date.now(), id);
    } else {
      db.prepare('UPDATE news SET payload = ?, error = NULL, updated_at = ? WHERE id = ?').run(JSON.stringify(payload), Date.now(), id);
    }
    addVersion(id, JSON.stringify(payload), actorOf(req), `Восстановлено из версии #${v.id}`);
    res.json(serialize(loadItem(id)!));
  });

  app.get('/api/news/:id/history', staff, (req, res) => {
    const id = Number(req.params.id);
    const item = loadItem(id);
    if (!item) return res.status(404).json({ error: 'Новость не найдена' });
    const out: { ts: number; actor: string; action: string }[] = [];
    for (const v of db.prepare('SELECT ts, actor, note FROM news_versions WHERE news_id = ?').all(id) as { ts: number; actor: string; note: string }[]) {
      out.push({ ts: v.ts, actor: v.actor, action: v.note || 'Сохранено' });
    }
    // audit entries about this item that are not already a saved version
    const audit = db
      .prepare("SELECT ts, actor, action FROM audit WHERE detail = ? AND action IN ('Новость отправлена в Discord', 'Изменено время публикации новости', 'Создана копия новости')")
      .all(`#${id}`) as { ts: number; actor: string; action: string }[];
    out.push(...audit);
    if (item.sent_at) out.push({ ts: item.sent_at, actor: 'бот', action: 'Опубликовано в Discord' });
    out.sort((a, b) => b.ts - a.ts);
    res.json(out.slice(0, 200));
  });

  app.post('/api/news/:id/duplicate', staff, (req, res) => {
    const src = loadItem(Number(req.params.id));
    if (!src) return res.status(404).json({ error: 'Новость не найдена' });
    const p = JSON.parse(src.payload) as NewsPayload;
    const SUFFIX = ' (копия)';
    if (p.embed?.title?.trim()) p.embed.title = cut(p.embed.title, 256 - SUFFIX.length) + SUFFIX;
    else if (p.content.trim()) p.content = cut(p.content, 2000 - SUFFIX.length) + SUFFIX;
    else if (p.embed?.description?.trim()) p.embed.description = cut(p.embed.description, 4096 - SUFFIX.length) + SUFFIX;
    const now = Date.now();
    const json = JSON.stringify(p);
    const info = db
      .prepare("INSERT INTO news (status, channel_id, payload, scheduled_at, repeat, created_at, updated_at) VALUES ('draft', ?, ?, NULL, 'none', ?, ?)")
      .run(src.channel_id, json, now, now);
    db.prepare('UPDATE news SET created_by = ? WHERE id = ?').run(uidOf(req), info.lastInsertRowid);
    addVersion(Number(info.lastInsertRowid), json, actorOf(req), `Копия новости #${src.id}`);
    res.status(201).json(serialize(db.prepare('SELECT * FROM news WHERE id = ?').get(info.lastInsertRowid) as NewsRow));
  });

  app.patch('/api/news/:id/schedule', staff, (req, res) => {
    const id = Number(req.params.id);
    const item = loadItem(id);
    if (!item) return res.status(404).json({ error: 'Новость не найдена' });
    const b = z.object({ scheduledAt: z.number().int().nullable() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Укажите время публикации или null' });
    if (!['draft', 'scheduled'].includes(item.status)) return res.status(409).json({ error: 'Время можно менять только у черновика или запланированной новости' });
    const now = Date.now();
    if (b.data.scheduledAt === null) {
      db.prepare("UPDATE news SET status = 'draft', scheduled_at = NULL, repeat = 'none', error = NULL, updated_at = ? WHERE id = ?").run(now, id);
    } else {
      if (b.data.scheduledAt <= now) return res.status(400).json({ error: 'Укажите время публикации в будущем' });
      const bad = check(JSON.parse(item.payload) as NewsPayload);
      if (bad) return res.status(400).json({ error: bad });
      db.prepare("UPDATE news SET status = 'scheduled', scheduled_at = ?, error = NULL, updated_at = ? WHERE id = ?").run(b.data.scheduledAt, now, id);
    }
    res.json(serialize(loadItem(id)!));
  });

  // publish a draft / scheduled / failed item right now
  app.post('/api/news/:id/publish', staff, (req, res) => {
    const id = Number(req.params.id);
    const r = db.prepare('SELECT * FROM news WHERE id = ?').get(id) as NewsRow | undefined;
    if (!r) return res.status(404).json({ error: 'Новость не найдена' });
    if (!['draft', 'scheduled', 'error'].includes(r.status)) return res.status(409).json({ error: 'Эта новость уже опубликована или отправляется' });
    const bad = check(JSON.parse(r.payload) as NewsPayload);
    if (bad) return res.status(400).json({ error: bad });
    db.prepare("UPDATE news SET status = 'queued', scheduled_at = NULL, error = NULL, updated_at = ? WHERE id = ?").run(Date.now(), id);
    res.json(serialize(db.prepare('SELECT * FROM news WHERE id = ?').get(id) as NewsRow));
  });

  app.delete('/api/news/:id', staff, (req, res) => {
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
    // test sends are throw-away: forget the old ones
    db.prepare('DELETE FROM news WHERE test = 1 AND updated_at < ?').run(now - 3600_000);
    const rows = db
      .prepare(
        `SELECT * FROM news WHERE (status IN ('queued','edit_queued','delete_queued') AND (next_try_at IS NULL OR next_try_at <= ?))
           OR (status = 'scheduled' AND scheduled_at <= ?)
           OR (status = 'sending' AND updated_at < ?)`,
      )
      .all(now, now, now - 2 * 60_000) as NewsRow[];
    const claim = db.prepare("UPDATE news SET status = 'sending', updated_at = ? WHERE id = ?");
    const out = rows.map((r) => {
      const action = r.status === 'edit_queued' ? 'edit' : r.status === 'delete_queued' ? 'delete' : 'send';
      // claim sends so a slow bot cannot post the same news twice
      if (action === 'send') claim.run(now, r.id);
      const stored = JSON.parse(r.payload) as NewsPayload;
      if (action === 'delete') return { id: r.id, action, channelId: r.channel_id, messageId: r.message_id, payload: stored, statusEmbeds: [], test: false };
      // variables are substituted and status cards built right now, at send time
      const { payload, statusEmbeds } = resolvePayload(stored, !!r.test, r.id);
      return { id: r.id, action, channelId: r.channel_id, messageId: r.message_id, payload, statusEmbeds, test: !!r.test };
    });
    res.json(out);
  });

  app.patch('/internal/news/:id', internal, (req, res) => {
    const b = z
      .object({
        status: z.enum(['sent', 'error', 'deleted']),
        messageId: z.string().max(40).nullable().optional(),
        error: z.string().max(300).nullable().optional(),
        /** Discord 429: do not retry before this many ms */
        retryAfterMs: z.number().int().min(0).max(3600_000).optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad body' });
    const id = Number(req.params.id);
    const now = Date.now();
    const before = db.prepare('SELECT status, channel_id, payload, attempts, test FROM news WHERE id = ?').get(id) as
      | { status: string; channel_id: string; payload: string; attempts: number; test: number }
      | undefined;
    const action = before?.status === 'edit_queued' ? 'edit' : before?.status === 'delete_queued' ? 'delete' : 'send';
    const ledger = (status: 'sent' | 'error' | 'dead', attempts: number, error: string | null, nextTryAt: number | null) => {
      if (!before || before.test) return;
      let summary = '';
      try {
        const p = JSON.parse(before.payload) as NewsPayload;
        summary = String(p.embed?.title || p.content || '').slice(0, 120);
      } catch {
        /* informational only */
      }
      ledgerRecord({ kind: 'news', refId: id, target: before.channel_id, status, attempts, error, nextTryAt, payload: { action, summary }, now });
    };
    if (b.data.status === 'deleted') {
      ledger('sent', (before?.attempts ?? 0) + 1, null, null);
      db.prepare('DELETE FROM news WHERE id = ?').run(id);
    } else if (db.prepare('SELECT 1 FROM news WHERE id = ? AND test = 1').get(id)) {
      db.prepare('UPDATE news SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(
        b.data.status === 'sent' ? 'test_sent' : 'test_error',
        b.data.status === 'sent' ? null : (b.data.error ?? 'Ошибка отправки'),
        now,
        id,
      );
    } else if (b.data.status === 'sent') {
      const prev = db.prepare('SELECT * FROM news WHERE id = ?').get(id) as NewsRow | undefined;
      // the first successful post of a repeating item schedules the next one
      if (prev && prev.repeat !== 'none' && !prev.sent_at && prev.scheduled_at) {
        const next = nextOccurrence(prev.scheduled_at, prev.repeat, now);
        db.prepare("INSERT INTO news (status, channel_id, payload, scheduled_at, repeat, created_at, updated_at, created_by) VALUES ('scheduled', ?, ?, ?, ?, ?, ?, ?)").run(prev.channel_id, prev.payload, next, prev.repeat, now, now, prev.created_by ?? null);
      }
      ledger('sent', (before?.attempts ?? 0) + 1, null, null);
      db.prepare("UPDATE news SET status = 'sent', attempts = 0, next_try_at = NULL, message_id = COALESCE(?, message_id), sent_at = COALESCE(sent_at, ?), error = ?, updated_at = ? WHERE id = ?").run(
        b.data.messageId ?? null,
        now,
        b.data.error ?? null,
        now,
        id,
      );
      // the first post of an item (not a repeat of the edit): the subscribers of its rubric are told
      if (prev && !prev.sent_at && prev.repeat === 'none') {
        try {
          const p = JSON.parse(prev.payload) as NewsPayload;
          notifyNewsPublished({ id, title: titleOf(p), category: p.category ?? 'announcement', authorId: prev.created_by ?? null }, deps.publicBase() ?? '');
        } catch { /* the post itself is done */ }
      }
    } else {
      const err = b.data.error ?? 'Ошибка отправки';
      const plan = planFailure(before?.attempts ?? 0, now, { retryAfterMs: b.data.retryAfterMs });
      if (plan.status === 'error') {
        // retry later with backoff: a post goes back to the queue, an edit/delete simply waits (its status is untouched)
        db.prepare("UPDATE news SET status = CASE WHEN status = 'sending' THEN 'queued' ELSE status END, attempts = ?, next_try_at = ?, error = ?, updated_at = ? WHERE id = ?").run(plan.attempts, plan.nextTryAt, err, now, id);
        ledger('error', plan.attempts, err, plan.nextTryAt);
      } else {
        // out of attempts: a failed edit/delete keeps the posted message ("sent"), a failed post becomes "error"
        const row = db.prepare('SELECT message_id FROM news WHERE id = ?').get(id) as { message_id: string | null } | undefined;
        db.prepare('UPDATE news SET status = ?, attempts = ?, next_try_at = NULL, error = ?, updated_at = ? WHERE id = ?').run(row?.message_id ? 'sent' : 'error', Math.min(plan.attempts, MAX_ATTEMPTS), err, now, id);
        ledger('dead', plan.attempts, err, null);
      }
    }
    res.json({ ok: true });
  });
}
