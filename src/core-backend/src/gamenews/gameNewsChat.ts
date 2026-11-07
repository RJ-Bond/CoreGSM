/**
 * The game chat for the administrators in Discord: the plugin reads the messages players write (the general chat, the
 * clan chat, the chat of the players nearby; private whispers never) and sends them here; the panel posts them to one
 * Discord webhook: «[Общий] WhiteLegioN: Привет». A switch for every kind of chat decides what goes to the channel.
 *
 *  - the webhook address is a secret: kept encrypted, only «set / not set» and the tail of the address are shown;
 *  - only Discord addresses are accepted (the panel never calls an address an administrator could point inside the network);
 *  - lines are collected and posted a few at a time (Discord allows about five posts in two seconds per webhook), a
 *    flood is cut, a «rate limited» answer pauses the channel;
 *  - nothing a player writes can ping anybody (allowed_mentions is empty) or break the formatting.
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { db, getSetting, setSetting } from '../db.js';
import { log } from '../logger.js';
import { decryptSecret, encryptSecret } from '../security/secrets.js';
import { pluginTarget } from './gameNews.js';
import {
  CHAT_KINDS, activeChatKinds, chunkLines, formatChatLine, isDiscordWebhook, normalizeChat, type ChatKind, type ChatStored,
} from './gameNewsChatLogic.js';

const read = (): ChatStored => {
  try {
    return normalizeChat(JSON.parse(getSetting('gamenews_chat') || '{}'));
  } catch {
    return normalizeChat({});
  }
};
const write = (s: ChatStored): void => setSetting('gamenews_chat', JSON.stringify(s));

function webhookUrl(): string | null {
  const enc = read().webhook;
  if (!enc) return null;
  try {
    const url = decryptSecret(enc);
    return isDiscordWebhook(url) ? url : null;
  } catch {
    return null;
  }
}

/** the kinds of chat that are being forwarded (what the plugin has to read) */
export const chatKinds = (): ChatKind[] => activeChatKinds(read());

export function chatSettingsView(): { enabled: boolean; set: boolean; tail: string; kinds: Record<ChatKind, boolean> } {
  const s = read();
  const u = webhookUrl();
  return { enabled: s.enabled, set: !!u, tail: u ? `…${u.slice(-6)}` : '', kinds: s.kinds };
}

// ---- posting
const MAX_QUEUE = 200;
let queue: string[] = [];
let pausedUntil = 0;

function enqueue(line: string): void {
  queue.push(line);
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE); // a flood: the oldest lines go
}

async function post(url: string, content: string): Promise<{ ok: boolean; retryAfter: number }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, username: 'CoreGSM', allowed_mentions: { parse: [] } }),
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
  if (!queue.length || pausedUntil > now) return;
  const url = webhookUrl();
  const lines = queue;
  queue = [];
  if (!url) return;
  const chunks = chunkLines(lines);
  for (let i = 0; i < chunks.length; i++) {
    const r = await post(url, chunks[i]);
    if (r.retryAfter) {
      pausedUntil = now + r.retryAfter * 1000;
      // the chunk that was refused and the rest wait for the next pass
      queue = [...chunks.slice(i).flatMap((c) => c.split('\n')), ...queue].slice(-MAX_QUEUE);
      return;
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
  text: z.string().max(600),
});

function serverLabelOf(id: number): string {
  const r = db.prepare("SELECT COALESCE(NULLIF(s.name, ''), NULLIF(st.name, ''), s.host || ':' || s.port) AS n FROM servers s LEFT JOIN status st ON st.server_id = s.id WHERE s.id = ?").get(id) as { n: string } | undefined;
  return r?.n ?? '';
}

export function registerGameNewsChat({ app, admin }: { app: Express; admin: RequestHandler }): void {
  // from the plugin: a batch of what players wrote
  app.post('/api/game-news/chat', (req, res) => {
    const t = pluginTarget(req);
    if (!t) return res.status(401).json({ error: 'unauthorized' });
    const b = z.object({ messages: z.array(messageSchema).max(30) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    const now = Date.now();
    if (flood(t.server_id, b.data.messages.length, now)) return res.status(429).json({ error: 'too many requests' });
    const kinds = new Set(chatKinds());
    // the name of the server is shown only when several servers write to the same channel
    const many = (db.prepare("SELECT COUNT(*) AS n FROM game_news_targets WHERE token_hash <> ''").get() as { n: number }).n > 1;
    const server = many ? serverLabelOf(t.server_id) : '';
    for (const m of b.data.messages) {
      if (!kinds.has(m.type)) continue;
      const line = formatChatLine(m.type, m.name, m.clan ?? '', m.text, server);
      if (line) enqueue(line);
    }
    res.json({ ok: true });
  });

  // from the administrator: the switch, the webhook (empty keeps the saved one, clear removes it) and the kinds of chat
  app.put('/api/game-news/chat-settings', admin, (req, res) => {
    const b = z.object({
      enabled: z.boolean().optional(),
      webhook: z.string().max(300).optional(),
      clear: z.boolean().optional(),
      kinds: z.object({ global: z.boolean(), clan: z.boolean(), local: z.boolean() }).partial().optional(),
    }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    const s = read();
    const w = b.data.webhook?.trim();
    if (w) {
      if (!isDiscordWebhook(w)) return res.status(400).json({ error: 'Это не адрес webhook Discord (https://discord.com/api/webhooks/…)' });
      s.webhook = encryptSecret(w);
    }
    if (b.data.clear) s.webhook = '';
    if (b.data.enabled !== undefined) s.enabled = b.data.enabled;
    for (const k of CHAT_KINDS) if (b.data.kinds?.[k] !== undefined) s.kinds[k] = b.data.kinds[k] as boolean;
    write(s);
    res.json({ ok: true });
  });

  // «Проверить»: one line into the channel
  app.post('/api/game-news/chat-test', admin, async (_req, res) => {
    const url = webhookUrl();
    if (!url) return res.status(400).json({ error: 'Сначала укажите webhook' });
    const r = await post(url, '✅ CoreGSM: канал подключён, сюда будет приходить чат игры.');
    res.json({ ok: r.ok });
  });
}
