/** Pure helpers of the extra alert channels (webhooks, e-mail): events, signature, message texts. No database, no network. */
import crypto from 'node:crypto';

export const CHANNEL_EVENTS = ['server_down', 'server_up', 'news_published', 'wipe', 'maintenance', 'bot_down', 'bot_up', 'panel_issue'] as const;
export type ChannelEvent = (typeof CHANNEL_EVENTS)[number];
export type ChannelKind = 'webhook' | 'email';

export const EVENT_LABELS: Record<ChannelEvent, string> = {
  server_down: 'Сервер недоступен',
  server_up: 'Сервер снова в сети',
  news_published: 'Опубликована новость',
  wipe: 'Запущен вайп',
  maintenance: 'Запланировано обслуживание',
  bot_down: 'Discord-бот не на связи',
  bot_up: 'Discord-бот снова на связи',
  panel_issue: 'Проблема с панелью (диск, база, опрос)',
};

export const isEvent = (v: unknown): v is ChannelEvent => typeof v === 'string' && (CHANNEL_EVENTS as readonly string[]).includes(v);

/** a webhook body larger than this is cut (the receiver is not ours) */
export const MAX_BODY_BYTES = 16 * 1024;
/** the answer of the receiver is read up to this size, the rest is dropped */
export const MAX_RESPONSE_BYTES = 8 * 1024;
export const WEBHOOK_TIMEOUT_MS = 10_000;

export interface EventData {
  event: ChannelEvent | 'test';
  /** one line in plain Russian */
  title: string;
  /** more detail, may be empty */
  text: string;
  /** machine readable details (server id and name, news id, ...) */
  data: Record<string, unknown>;
}

/** HMAC-SHA256 of `<timestamp>.<body>`, hex; sent as X-CoreGSM-Signature: sha256=<hex> */
export function signBody(secret: string, timestamp: number, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** what a receiver does to check a delivery (documented in the panel); constant time, tolerance in seconds */
export function verifySignature(secret: string, timestamp: number, body: string, header: string, now = Date.now(), toleranceSec = 300): boolean {
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > toleranceSec) return false;
  const want = Buffer.from(`sha256=${signBody(secret, timestamp, body)}`);
  const got = Buffer.from(header);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** the JSON body of a webhook call; `ts` is in seconds (the same value goes into the X-CoreGSM-Timestamp header) */
export function webhookBody(e: EventData, ts: number, deliveryId: number | string): string {
  const body = JSON.stringify({ id: String(deliveryId), event: e.event, timestamp: ts, title: e.title, text: e.text, data: e.data });
  if (Buffer.byteLength(body) <= MAX_BODY_BYTES) return body;
  // too large: the details are dropped, the message stays
  return JSON.stringify({ id: String(deliveryId), event: e.event, timestamp: ts, title: e.title.slice(0, 300), text: e.text.slice(0, 2000), data: {}, truncated: true });
}

export function webhookHeaders(secret: string, ts: number, body: string, event: string, deliveryId: number | string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': 'CoreGSM-Webhook/1',
    'X-CoreGSM-Event': event,
    'X-CoreGSM-Delivery': String(deliveryId),
    'X-CoreGSM-Timestamp': String(ts),
  };
  if (secret) h['X-CoreGSM-Signature'] = `sha256=${signBody(secret, ts, body)}`;
  return h;
}

/** the subject of the letter */
export const mailSubject = (brand: string, e: EventData): string => `[${brand}] ${e.title}`.slice(0, 200);

/** recipients typed as a list, a comma or semicolon separated text; invalid ones are reported */
export function parseRecipients(input: string | string[]): { ok: string[]; bad: string[] } {
  const parts = (Array.isArray(input) ? input : input.split(/[,;\s]+/)).map((x) => x.trim()).filter(Boolean);
  const ok: string[] = [];
  const bad: string[] = [];
  for (const p of parts) {
    if (/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/.test(p) && p.length <= 200) {
      if (!ok.some((x) => x.toLowerCase() === p.toLowerCase())) ok.push(p);
    } else bad.push(p);
  }
  return { ok, bad };
}

/** a report from the bot older than this means the bot is not running */
export const BOT_STALE_MS = 90_000;

/** Is the bot unreachable? `token`: a bot token is configured (a panel without a bot has no problem to report). */
export function botIsDown(s: { state: string; updatedAt: number }, token: boolean, now: number): boolean {
  if (!token) return false;
  return s.state !== 'online' || now - s.updatedAt > BOT_STALE_MS;
}
