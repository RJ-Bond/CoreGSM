/**
 * The game chat for the administrators in Discord: the plugin reads the messages players write (the global chat, the
 * clan chat, the local chat; private whispers never) and tells when a player joins or leaves; it sends that here and the
 * panel posts it to one Discord webhook, coloured like in the game:
 *
 *     [Глобальный] WhiteLegioN: Привет          * Игрок WhiteLegioN подключился к серверу.
 *
 * A switch for every kind decides what goes to the channel.
 *
 *  - the webhook address is a secret: kept encrypted, only «set / not set» and the tail of the address are shown;
 *  - only Discord addresses are accepted (the panel never calls an address an administrator could point inside the network);
 *  - lines are collected and posted a few at a time (Discord allows about five posts in two seconds per webhook), a
 *    flood is cut, a «rate limited» answer pauses the channel;
 *  - the messages are posted under the name and the picture of the webhook itself (a name can be set here to override it);
 *  - nothing a player writes can ping anybody or break the formatting.
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { hasOverride, overrides, readScoped, serverOf, writeScoped } from './gameNewsScope.js';
import { log } from '../logger.js';
import { decryptSecret, encryptSecret } from '../security/secrets.js';
import { pluginTarget } from './gameNews.js';
import {
  ANSI_COLORS, CHAT_KINDS, activeChatKinds, ansiChatLine, ansiEventLine, chunkLines, formatChatLine, formatEventLine, isDiscordWebhook,
  normalizeChat, paletteBlock, wrapForDiscord, type ChatKind, type ChatStored,
} from './gameNewsChatLogic.js';
import { getJoinLeave } from './gameNewsJoinLeave.js';
import { clock } from './gameNewsVars.js';

const read = (serverId?: number): ChatStored => {
  try {
    return normalizeChat(JSON.parse(readScoped('gamenews_chat', serverId) || '{}'));
  } catch {
    return normalizeChat({});
  }
};
const write = (s: ChatStored, serverId?: number): void => writeScoped('gamenews_chat', JSON.stringify(s), serverId);

function webhookUrl(s: ChatStored): string | null {
  if (!s.webhook) return null;
  try {
    const url = decryptSecret(s.webhook);
    return isDiscordWebhook(url) ? url : null;
  } catch {
    return null;
  }
}

/** the kinds of chat that are being forwarded (what the plugin has to read) */

export function chatSettingsView(serverId?: number): Pick<ChatStored, 'enabled' | 'kinds' | 'style' | 'senderName' | 'showTime' | 'colors' | 'fromDiscord'> & { set: boolean; tail: string; channel: boolean; confirmCard: boolean; confirmLine: boolean } {
  const s = read(serverId);
  const u = webhookUrl(s);
  return { enabled: s.enabled, set: !!u, tail: u ? `…${u.slice(-6)}` : '', kinds: s.kinds, style: s.style, senderName: s.senderName, showTime: s.showTime, colors: s.colors, fromDiscord: s.fromDiscord, channel: !!s.channelId, confirmCard: s.confirmCard, confirmLine: s.confirmLine };
}

/** the channel a webhook posts to (Discord tells it to anyone who holds the address) */
async function channelOf(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!res.ok) return '';
    const j = (await res.json()) as { channel_id?: unknown };
    return typeof j.channel_id === 'string' && /^\d{5,30}$/.test(j.channel_id) ? j.channel_id : '';
  } catch {
    return '';
  }
}

/** the channels where the bot listens: what an administrator writes there goes to the game chat of these servers */
export function chatChannels(): { channelId: string; serverIds: number[]; confirmCard: boolean; confirmLine: boolean }[] {
  const all = (db.prepare("SELECT server_id FROM game_news_targets WHERE token_hash <> ''").all() as { server_id: number }[]).map((r) => r.server_id);
  const own = overrides().gamenews_chat ?? [];
  const map = new Map<string, { ids: Set<number>; card: boolean; line: boolean }>();
  const add = (s: ChatStored, ids: number[]) => {
    if (!s.enabled || !s.fromDiscord || !s.channelId || !s.webhook || ids.length === 0) return;
    const e = map.get(s.channelId) ?? { ids: new Set<number>(), card: s.confirmCard, line: s.confirmLine };
    for (const id of ids) e.ids.add(id);
    map.set(s.channelId, e);
  };
  add(read(), all.filter((id) => !own.includes(id)));
  for (const id of own) if (all.includes(id)) add(read(id), [id]);
  return [...map].map(([channelId, e]) => ({ channelId, serverIds: [...e.ids], confirmCard: e.card, confirmLine: e.line }));
}

// ---- posting
const MAX_QUEUE = 200;
// one queue per set of chat settings: 0 = the general ones, a server id = that server's own (it may write to another channel)
const queues = new Map<number, string[]>();
const paused = new Map<number, number>();

function enqueue(scope: number, line: string): void {
  const q = queues.get(scope) ?? [];
  q.push(line);
  queues.set(scope, q.length > MAX_QUEUE ? q.slice(-MAX_QUEUE) : q); // a flood: the oldest lines go
}

async function post(url: string, content: string, sender: string): Promise<{ ok: boolean; retryAfter: number }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // no «username» unless one is set: the webhook's own name and picture are used
      body: JSON.stringify({ content, ...(sender ? { username: sender } : {}), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (res.ok) return { ok: true, retryAfter: 0 };
    if (res.status === 429) {
      const j = (await res.json().catch(() => ({}))) as { retry_after?: number };
      return { ok: false, retryAfter: Math.min(60, Math.max(1, Number(j.retry_after) || 2)) };
    }
    log.warn(`game chat to Discord: the webhook answered ${res.status}`);
    return { ok: false, retryAfter: 0 };
  } catch (e) {
    log.warn(`game chat to Discord failed: ${(e as Error).name}`);
    return { ok: false, retryAfter: 0 };
  }
}

/** one pass of the sender: what has gathered goes out, in chunks that fit a Discord message */
export async function flushChat(now = Date.now()): Promise<void> {
  for (const [scope, queue] of [...queues]) {
    if (!queue.length || (paused.get(scope) ?? 0) > now) continue;
    queues.set(scope, []);
    const s = read(scope || undefined);
    const url = webhookUrl(s);
    if (!url) continue;
    // the fences of a code block take a few characters
    const chunks = chunkLines(queue, s.style === 'ansi' ? 1850 : 1900);
    for (let i = 0; i < chunks.length; i++) {
      const r = await post(url, wrapForDiscord(s.style, chunks[i]), s.senderName);
      if (r.retryAfter) {
        paused.set(scope, now + r.retryAfter * 1000);
        // the chunk that was refused and the rest wait for the next pass
        queues.set(scope, [...chunks.slice(i).flatMap((c) => c.split(String.fromCharCode(10))), ...(queues.get(scope) ?? [])].slice(-MAX_QUEUE));
        break;
      }
    }
  }
}

let timer: NodeJS.Timeout | undefined;
let busy = false;
export function startChatTimer(): void {
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void flushChat().catch((e) => log.error('game chat sender failed', (e as Error).message)).finally(() => { busy = false; });
  }, 1500);
  timer.unref();
}
export const stopChatTimer = () => clearInterval(timer);

// ---- routes
const perServer = new Map<number, { n: number; reset: number }>();
function flood(serverId: number, count: number, now: number): boolean {
  const e = perServer.get(serverId);
  if (!e || e.reset < now) { perServer.set(serverId, { n: count, reset: now + 10_000 }); return false; }
  e.n += count;
  return e.n > 100;
}

const messageSchema = z.object({
  type: z.enum(CHAT_KINDS),
  name: z.string().max(100),
  clan: z.string().max(100).optional(),
  text: z.string().max(600).optional(),
});

const ansiColor = z.enum(ANSI_COLORS);
const colorsSchema = z.object(Object.fromEntries(CHAT_KINDS.map((k) => [k, z.object({ tag: ansiColor, name: ansiColor, text: ansiColor }).partial()]))).partial();

export function registerGameNewsChat({ app, admin }: { app: Express; admin: RequestHandler }): void {
  // from the plugin: a batch of what players wrote and of who joined or left
  app.post('/api/game-news/chat', (req, res) => {
    const t = pluginTarget(req);
    if (!t) return res.status(401).json({ error: 'unauthorized' });
    const b = z.object({ messages: z.array(messageSchema).max(30) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    const now = Date.now();
    if (flood(t.server_id, b.data.messages.length, now)) return res.status(429).json({ error: 'too many requests' });
    // a server with its own chat settings writes by them (maybe to its own channel), the others by the general ones
    const scope = hasOverride('gamenews_chat', t.server_id) ? t.server_id : 0;
    const s = read(scope || undefined);
    const kinds = new Set(activeChatKinds(s));
    // the name of the server is not put into the lines: a server that needs its own channel gets its own settings
    const server = '';
    const jl = getJoinLeave(t.server_id);
    const time = s.showTime ? clock(now) : '';
    for (const m of b.data.messages) {
      if (!kinds.has(m.type)) continue;
      const colors = s.colors[m.type];
      let line: string;
      if (m.type === 'join' || m.type === 'leave') {
        // the same words as in the game (set in «Вход и выход игроков»)
        const template = m.type === 'join' ? jl.joinText : jl.leaveText;
        line = s.style === 'ansi' ? ansiEventLine(template, m.name, colors, server, time) : formatEventLine(template, m.name, server, time);
      } else {
        line = s.style === 'ansi'
          ? ansiChatLine(m.type, m.name, m.clan ?? '', m.text ?? '', colors, server, time)
          : formatChatLine(m.type, m.name, m.clan ?? '', m.text ?? '', server, time);
      }
      if (line) enqueue(scope, line);
    }
    res.json({ ok: true });
  });

  // from the administrator: the switch, the webhook (empty keeps the saved one, clear removes it), what to forward, how it looks
  app.put('/api/game-news/chat-settings', admin, async (req, res) => {
    const b = z.object({
      enabled: z.boolean().optional(),
      webhook: z.string().max(300).optional(),
      clear: z.boolean().optional(),
      kinds: z.object(Object.fromEntries(CHAT_KINDS.map((k) => [k, z.boolean()]))).partial().optional(),
      style: z.enum(['ansi', 'plain']).optional(),
      senderName: z.string().max(80).optional(),
      showTime: z.boolean().optional(),
      fromDiscord: z.boolean().optional(),
      confirmCard: z.boolean().optional(),
      confirmLine: z.boolean().optional(),
      colors: colorsSchema.optional(),
    }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    const sid = serverOf(req);
    const s = read(sid);
    const w = b.data.webhook?.trim();
    if (w) {
      if (!isDiscordWebhook(w)) return res.status(400).json({ error: 'Это не адрес webhook Discord (https://discord.com/api/webhooks/…)' });
      s.webhook = encryptSecret(w);
      s.channelId = await channelOf(w);
    }
    if (b.data.clear) { s.webhook = ''; s.channelId = ''; s.fromDiscord = false; }
    if (b.data.fromDiscord !== undefined) s.fromDiscord = b.data.fromDiscord;
    if (b.data.confirmCard !== undefined) s.confirmCard = b.data.confirmCard;
    if (b.data.confirmLine !== undefined) s.confirmLine = b.data.confirmLine;
    // an old webhook saved before the channel was remembered: find it now
    if (s.fromDiscord && !s.channelId) {
      const url = webhookUrl(s);
      if (url) s.channelId = await channelOf(url);
      if (!s.channelId) return res.status(400).json({ error: 'Не удалось определить канал webhook: сохраните адрес заново' });
    }
    if (b.data.enabled !== undefined) s.enabled = b.data.enabled;
    for (const k of CHAT_KINDS) {
      const on = (b.data.kinds as Partial<Record<ChatKind, boolean>> | undefined)?.[k];
      if (on !== undefined) s.kinds[k] = on;
      const c = (b.data.colors as Partial<Record<ChatKind, Partial<Record<'tag' | 'name' | 'text', (typeof ANSI_COLORS)[number]>>>> | undefined)?.[k];
      if (c) s.colors[k] = { ...s.colors[k], ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) };
    }
    if (b.data.style) s.style = b.data.style;
    if (b.data.showTime !== undefined) s.showTime = b.data.showTime;
    if (b.data.senderName !== undefined) s.senderName = normalizeChat({ senderName: b.data.senderName }).senderName;
    write(s, sid);
    res.json({ ok: true });
  });

  // «Проверить»: a few sample lines into the channel, the way real ones will look
  app.post('/api/game-news/chat-test', admin, async (req, res) => {
    const sid = serverOf(req);
    const s = read(sid);
    const url = webhookUrl(s);
    if (!url) return res.status(400).json({ error: 'Сначала укажите webhook' });
    const jl = getJoinLeave(sid);
    const now = clock(Date.now());
    const tm = s.showTime ? now : '';
    const lines = s.style === 'ansi'
      ? [
        ansiChatLine('global', 'WhiteLegioN', '', 'Привет всем!', s.colors.global, '', tm),
        ansiChatLine('clan', 'WhiteLegioN', 'Ночные', 'Сбор у замка', s.colors.clan, '', tm),
        ansiChatLine('local', 'WhiteLegioN', '', 'Кто рядом?', s.colors.local, '', tm),
        ansiEventLine(jl.joinText, 'WhiteLegioN', s.colors.join, '', tm),
        ansiEventLine(jl.leaveText, 'WhiteLegioN', s.colors.leave, '', tm),
      ]
      : [
        formatChatLine('global', 'WhiteLegioN', '', 'Привет всем!', '', tm),
        formatChatLine('clan', 'WhiteLegioN', 'Ночные', 'Сбор у замка', '', tm),
        formatChatLine('local', 'WhiteLegioN', '', 'Кто рядом?', '', tm),
        formatEventLine(jl.joinText, 'WhiteLegioN', '', tm),
        formatEventLine(jl.leaveText, 'WhiteLegioN', '', tm),
      ];
    // «Палитра»: the eight colours as Discord draws them (the panel's preview is checked against this)
    if (req.query.palette) {
      const p = await post(url, wrapForDiscord('ansi', paletteBlock()), s.senderName);
      return res.json({ ok: p.ok });
    }
    const r = await post(url, '✅ CoreGSM: канал подключён. Так будет выглядеть чат игры:', s.senderName);
    if (r.ok) await post(url, wrapForDiscord(s.style, lines.join('\n')), s.senderName);
    res.json({ ok: r.ok });
  });
}
