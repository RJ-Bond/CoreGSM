/**
 * The game chat for the administrators in Discord: the plugin reads the messages players write (the general chat, the
 * clan chat, the chat of the players nearby; private whispers never) and sends them here; the panel posts them to a
 * Discord webhook of the channel set for that kind of chat: «[Общий] WhiteLegioN: Привет».
 *
 *  - the webhook addresses are secrets: kept encrypted, only «set / not set» and the tail of the address are shown;
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
import { CHAT_KINDS, chunkLines, formatChatLine, isDiscordWebhook, type ChatKind } from './gameNewsChatLogic.js';
import { chatKindsConfigured } from './gameNewsVars.js';

interface Stored { enabled: boolean; webhooks: Partial<Record<ChatKind, string>> }

const read = (): Stored => {
  try {
    const v = JSON.parse(getSetting('gamenews_chat') || '{}') as Partial<Stored>;
    return { enabled: !!v.enabled, webhooks: v.webhooks && typeof v.webhooks === 'object' ? v.webhooks : {} };
  } catch {
    return { enabled: false, webhooks: {} };
  }
};
const write = (s: Stored): void => setSetting('gamenews_chat', JSON.stringify(s));

function webhookOf(kind: ChatKind): string | null {
  const enc = read().webhooks[kind];
  if (!enc) return null;
  try {
    const url = decryptSecret(enc);
    return isDiscordWebhook(url) ? url : null;
  } catch {
    return null;
  }
}

/** the kinds of chat that are being forwarded (what the plugin has to read) */
export const chatKinds = (): ChatKind[] => chatKindsConfigured();

export function chatSettingsView(): { enabled: boolean; set: Record<ChatKind, boolean>; tail: Record<ChatKind, string> } {
  const s = read();
  const set = { global: false, clan: false, local: false } as Record<ChatKind, boolean>;
  const tail = { global: '', clan: '', local: '' } as Record<ChatKind, string>;
  for (const k of CHAT_KINDS) {
    const u = webhookOf(k);
    set[k] = !!u;
    tail[k] = u ? `…${u.slice(-6)}` : '';
  }
  return { enabled: s.enabled, set, tail };
}

// ---- posting
const MAX_QUEUE = 200;
const queues = new Map<ChatKind, string[]>();
const pausedUntil = new Map<ChatKind, number>();

function enqueue(kind: ChatKind, line: string): void {
  const q = queues.get(kind) ?? [];
  q.push(line);
  if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE); // a flood: the oldest lines go
  queues.set(kind, q);
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
  for (const kind of CHAT_KINDS) {
    const q = queues.get(kind);
    if (!q?.length || (pausedUntil.get(kind) ?? 0) > now) continue;
    const url = webhookOf(kind);
    queues.set(kind, []);
    if (!url) continue;
    for (const chunk of chunkLines(q)) {
      const r = await post(url, chunk);
      if (r.retryAfter) {
        pausedUntil.set(kind, now + r.retryAfter * 1000);
        // put the rest back at the front, the chunk that failed with it
        const rest = q.slice(q.indexOf(chunk.split('\n')[0]));
        queues.set(kind, [...rest, ...(queues.get(kind) ?? [])].slice(-MAX_QUEUE));
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
  text: z.string().max(600),
});

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
      if (line) enqueue(m.type, line);
    }
    res.json({ ok: true });
  });

  // from the administrator: switch and webhooks (an empty field keeps the saved address, «clear» removes it)
  app.put('/api/game-news/chat-settings', admin, (req, res) => {
    const b = z.object({
      enabled: z.boolean(),
      global: z.string().max(300).optional(),
      clan: z.string().max(300).optional(),
      local: z.string().max(300).optional(),
      clear: z.array(z.enum(CHAT_KINDS)).optional(),
    }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    const s = read();
    for (const k of CHAT_KINDS) {
      const v = b.data[k]?.trim();
      if (!v) continue;
      if (!isDiscordWebhook(v)) return res.status(400).json({ error: 'Это не адрес webhook Discord (https://discord.com/api/webhooks/…)' });
      s.webhooks[k] = encryptSecret(v);
    }
    for (const k of b.data.clear ?? []) delete s.webhooks[k];
    s.enabled = b.data.enabled;
    write(s);
    res.json({ ok: true });
  });

  // «Проверить»: one line into the channel of that kind
  app.post('/api/game-news/chat-test', admin, async (req, res) => {
    const b = z.object({ kind: z.enum(CHAT_KINDS) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    const url = webhookOf(b.data.kind);
    if (!url) return res.status(400).json({ error: 'Сначала укажите webhook для этого чата' });
    const r = await post(url, '✅ CoreGSM: канал подключён, сюда будет приходить чат игры.');
    res.json({ ok: r.ok });
  });
}

function serverLabelOf(id: number): string {
  const r = db.prepare('SELECT COALESCE(NULLIF(s.name, \'\'), NULLIF(st.name, \'\'), s.host || \':\' || s.port) AS n FROM servers s LEFT JOIN status st ON st.server_id = s.id WHERE s.id = ?').get(id) as { n: string } | undefined;
  return r?.n ?? '';
}
