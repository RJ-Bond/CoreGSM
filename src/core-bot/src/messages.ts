/** What the bot posts: status messages of bindings and news written in the panel. */
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { backend } from './backend.js';

export interface Binding {
  id: number;
  serverId: number;
  /** every server shown in this message (the main one first); one embed per server */
  serverIds?: number[];
  serverName: string;
  channelId: string;
  messageId: string | null;
  intervalSec: number;
  /** embed (default), card (PNG) or both */
  style?: 'embed' | 'card' | 'both';
}

export type RawEmbed = ConstructorParameters<typeof EmbedBuilder>[0] & {
  title?: string;
  description?: string;
  url?: string;
  author?: { name: string };
  timestamp?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string; icon_url?: string };
};

/** characters Discord counts towards the 6000 limit of one message (title, description, fields, footer) */
export function embedChars(e: { title?: string; description?: string; fields?: { name: string; value: string }[]; footer?: { text: string }; author?: { name: string } }): number {
  return (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.author?.name.length ?? 0) + (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
}

/** the servers of one message: the main one first, no duplicates, at most 10 (a Discord limit) */
export const messageServerIds = (b: Pick<Binding, 'serverId' | 'serverIds'>) => [...new Set([b.serverId, ...(b.serverIds ?? [])])].slice(0, 10);

/**
 * Several servers in one message: the brand line (author) only on the first embed, footer and timestamp only on
 * the last one; over the 6000-character limit the extra fields go first, from the last server backwards.
 */
export function arrangeEmbeds(raws: RawEmbed[]): void {
  if (raws.length < 2) return;
  raws.forEach((r, i) => {
    if (i > 0) delete r.author;
    if (i < raws.length - 1) {
      delete r.footer;
      delete r.timestamp;
    }
  });
  const total = () => raws.reduce((n, r) => n + embedChars(r), 0);
  for (let i = raws.length - 1; i >= 0 && total() > 5800; i--) {
    const f = raws[i].fields;
    if (f && f.length > 6) raws[i].fields = f.slice(0, 6);
  }
}

/** «Все игроки» link buttons: the players tab of each server in the panel, one per server for up to 5 servers */
export function playerButtons(raws: RawEmbed[]): { label: string; url: string }[] {
  const multi = raws.length > 1;
  const out: { label: string; url: string }[] = [];
  for (const r of raws.slice(0, 5)) {
    if (!r.url || !/^https?:\/\//.test(r.url)) continue;
    out.push({ label: multi ? `👥 ${String(r.title ?? 'Сервер').slice(0, 70)}` : '👥 Все игроки на сайте', url: `${r.url.replace(/\/$/, '')}/players` });
  }
  return out;
}

const linkRow = (links: { label: string; url: string }[]) =>
  links.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(links.map((l) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(l.label).setURL(l.url)))] : [];

/** Builds what a binding's message looks like (embeds, card attachments, buttons). */
export async function buildPayload(b: Binding) {
  const style = b.style ?? 'embed';
  const ids = messageServerIds(b);
  const multi = ids.length > 1;
  const raws: RawEmbed[] = [];
  const files: AttachmentBuilder[] = [];

  for (const [i, id] of ids.entries()) {
    // the embed layout (emojis, fields, colours) is defined once in the backend and shared with the panel preview
    let raw: RawEmbed;
    if (style === 'card') {
      raw = { color: 0x5a4bd1, timestamp: new Date().toISOString() };
    } else {
      const r = await backend(`/internal/servers/${id}/embed?interval=${b.intervalSec}`);
      if (!r.ok) {
        // a deleted server must not break the whole message
        if (multi && r.status === 404) continue;
        throw new Error(`embed HTTP ${r.status}`);
      }
      raw = (await r.json()) as RawEmbed;
    }
    if (style !== 'embed') {
      const img = await backend(`/internal/card/${id}.png`);
      if (!img.ok) {
        if (multi && img.status === 404) continue;
        throw new Error(`card HTTP ${img.status}`);
      }
      const name = multi ? `card-${i}.png` : 'card.png';
      files.push(new AttachmentBuilder(Buffer.from(await img.arrayBuffer()), { name }));
      (raw as { image?: { url: string } }).image = { url: `attachment://${name}` };
    }
    raws.push(raw);
  }
  if (raws.length === 0) throw new Error('Нет ни одного сервера для сообщения');
  arrangeEmbeds(raws);
  return { embeds: raws.map((r) => new EmbedBuilder(r)), files, components: linkRow(playerButtons(raws)) };
}

// ---------- news: messages written in the panel ----------
export interface NewsEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  author?: { name: string; iconUrl?: string };
  thumbnailUrl?: string;
  image?: { url?: string; upload?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: boolean;
}
export interface NewsPayload {
  content: string;
  mention: 'none' | 'here' | 'everyone';
  embed?: NewsEmbed;
  /** more embeds in the same message (variables are already substituted by the panel) */
  extraEmbeds?: NewsEmbed[];
  /** link buttons under the message (at most 3) */
  actions?: { label: string; url: string }[];
}

/** the message text with the @everyone/@here mention in front, added once: not when the text already has it */
export function newsContent(p: Pick<NewsPayload, 'content' | 'mention'>): string {
  const token = p.mention === 'everyone' ? '@everyone' : p.mention === 'here' ? '@here' : '';
  const mention = token && !(p.content ?? '').includes(token) ? token : '';
  return [mention, p.content?.trim()].filter(Boolean).join('\n');
}

export async function buildNews(p: NewsPayload, statusEmbeds: Record<string, unknown>[] = []) {
  const files: AttachmentBuilder[] = [];
  const content = newsContent(p);
  const embeds: EmbedBuilder[] = [];
  const attached = new Set<string>();
  for (const e of [...(p.embed ? [p.embed] : []), ...(p.extraEmbeds ?? [])].slice(0, 10)) {
    const eb = new EmbedBuilder().setColor(e.color ?? 0x5865f2);
    if (e.title) eb.setTitle(e.title);
    if (e.url) eb.setURL(e.url);
    if (e.description) eb.setDescription(e.description);
    if (e.author?.name) eb.setAuthor({ name: e.author.name, ...(e.author.iconUrl ? { iconURL: e.author.iconUrl } : {}) });
    if (e.thumbnailUrl) eb.setThumbnail(e.thumbnailUrl);
    if (e.image?.upload) {
      // a picture uploaded in the panel travels as an attachment (once, even when several embeds use it)
      if (!attached.has(e.image.upload)) {
        const r = await backend(`/api/news/images/${e.image.upload}`);
        if (!r.ok) throw new Error('Не удалось получить загруженную картинку (она могла быть удалена)');
        files.push(new AttachmentBuilder(Buffer.from(await r.arrayBuffer()), { name: e.image.upload }));
        attached.add(e.image.upload);
      }
      eb.setImage(`attachment://${e.image.upload}`);
    } else if (e.image?.url) {
      eb.setImage(e.image.url);
    }
    if (e.fields?.length) eb.addFields(e.fields.map((x) => ({ name: x.name, value: x.value, inline: !!x.inline })));
    if (e.footer?.text) eb.setFooter({ text: e.footer.text });
    if (e.timestamp) eb.setTimestamp();
    embeds.push(eb);
  }
  for (const raw of statusEmbeds) {
    if (embeds.length >= 10) break;
    embeds.push(new EmbedBuilder(raw as RawEmbed));
  }
  return {
    content: content || undefined,
    embeds,
    files,
    components: linkRow((p.actions ?? []).slice(0, 3).map((a) => ({ label: a.label.slice(0, 80), url: a.url }))),
    allowedMentions: { parse: (p.mention === 'none' ? [] : ['everyone']) as 'everyone'[] },
  };
}
