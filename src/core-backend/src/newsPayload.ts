/** News payload: validation (Discord limits), tidying and the helpers that read a payload. */
import { z } from 'zod';
import { gameProfile } from './games.js';

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

export const payloadSchema = z.object({
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

export type EmbedIn = z.infer<typeof embedSchema>;
export type NewsPayload = z.infer<typeof payloadSchema>;

export const bodySchema = z.object({
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

export function tidy(p: NewsPayload): NewsPayload {
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

export const allEmbeds = (p: NewsPayload): EmbedIn[] => [...(p.embed ? [p.embed] : []), ...(p.extraEmbeds ?? [])];

interface PlainEmbed {
  title?: string;
  description?: string;
  author?: { name: string };
  footer?: { text: string };
  fields?: { name: string; value: string }[];
}
export function embedLength(e: PlainEmbed): number {
  return (
    (e.title?.length ?? 0) +
    (e.description?.length ?? 0) +
    (e.author?.name.length ?? 0) +
    (e.footer?.text.length ?? 0) +
    (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0)
  );
}

/** Returns an error message when the payload cannot be posted, otherwise null. */
export function check(p: NewsPayload): string | null {
  const embeds = allEmbeds(p);
  if (!p.content.trim() && !embeds.length && !p.statusServerIds?.length) return 'Напишите текст или заполните embed: пустое сообщение отправить нельзя';
  if (embeds.length > 10) return 'В сообщении не больше 10 embed';
  for (const e of embeds) if (embedLength(e) > 6000) return 'Embed длиннее 6000 символов (лимит Discord): сократите текст';
  if (embeds.reduce((n, e) => n + embedLength(e), 0) > 6000) return 'Все embed вместе длиннее 6000 символов (лимит Discord): сократите текст';
  return null;
}

export const titleOf = (p: NewsPayload) => p.embed?.title?.trim() || p.content.trim().slice(0, 70) || p.embed?.description?.trim().slice(0, 70) || 'Без названия';

/** the next time a repeating item should go out, always in the future */
export function nextOccurrence(from: number, repeat: string, now: number): number {
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

export const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
